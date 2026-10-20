// 상세 슬라이드 '게시글 예시' 영역 배치 (작성 가이드 + 템플릿 안내선 기준)
//  - 제목 캡처: 안내선 3.66cm 에서 가로 15cm (크면 12cm 까지 줄임), 5.93cm 부터
//  - 본문 캡처: 안내선 4.56cm 에서 시작, 원본 크기의 51% (크거나 많으면 46%) — 게시물마다 글자 크기가 같게
//  - 댓글 캡처: 3.66cm, 본문과 같은 배율, 아래 안내선(17.13cm)에 맞춰 아래에서 위로
//  - 본문 첨부 이미지: 오른쪽 영역(19.86~25.66cm), 8.03cm 부터 / 크거나 많으면 5.93cm 까지 확장
(function (global) {
  const CM = 360000; // EMU
  const G = {
    xText: 1316037, // 3.66cm
    xBody: 1639887, // 4.56cm
    xRight: 6716712, // 18.66cm
    xImg: 7148512, // 19.86cm
    xImgR: 9237662, // 25.66cm
    yTop: 2133600, // 5.93cm
    yImg: 2889250, // 8.03cm
    yBottom: 6165850, // 17.13cm
  };
  const GAP = 0.3 * CM;
  const IMG_GAP = 0.2 * CM;
  const TITLE_W = [15 * CM, 12 * CM];
  const TITLE_MAX_H = 2.7 * CM; // 15cm 로 놓았을 때 이보다 높으면 12cm 로
  const TITLE_CROP_H = 3.2 * CM; // 12cm 로도 이보다 높으면 아래를 자름
  // 원본 화면 1px 이 슬라이드에서 차지하는 길이 (100% 기준).
  // 윈도우 125% 화면에서 캡처해 붙여넣은(96dpi) 기존 보고서와 같은 글자 크기가 되도록 맞춘 값.
  const CSS_PX_EMU = (1.25 / 96) * 2.54 * CM;
  const SCALES = [0.51, 0.46];

  const sizeAt = (item, scale, maxW) => {
    let w = item.cssWidth * CSS_PX_EMU * scale;
    if (w > maxW) w = maxW;
    return { w, h: (w * item.cssHeight) / item.cssWidth };
  };

  // 오른쪽 이미지 영역: 가로로 긴 그림은 모두 같은 폭(영역 전체 폭)으로 한 줄씩,
  // 세로로 긴 그림은 같은 폭으로 두 개씩 나란히. 넘치면 전체를 같은 비율로 줄인다 (폭이 그림마다 들쭉날쭉하지 않게).
  function layoutImagesUniform(images, top) {
    const areaW = G.xImgR - G.xImg;
    const areaH = G.yBottom - top;
    const rows = [];
    for (let i = 0; i < images.length; i++) {
      const im = images[i];
      const portrait = im.cssHeight > im.cssWidth;
      const nxt = images[i + 1];
      if (portrait && nxt && nxt.cssHeight > nxt.cssWidth) {
        rows.push([i, i + 1]);
        i++;
      } else rows.push([i]);
    }
    const place = (s) => {
      const out = [];
      let y = top;
      for (const row of rows) {
        const w = row.length === 2 || images[row[0]].cssHeight > images[row[0]].cssWidth ? ((areaW - IMG_GAP) / 2) * s : areaW * s;
        const hs = row.map((i) => (w * images[i].cssHeight) / images[i].cssWidth);
        const rowW = row.length * w + (row.length - 1) * IMG_GAP;
        let x = G.xImg + (areaW - rowW) / 2;
        row.forEach((i, k) => {
          out.push({ i, x, y, w, h: hs[k] });
          x += w + IMG_GAP;
        });
        y += Math.max(...hs) + IMG_GAP;
      }
      return { placed: out, height: y - IMG_GAP - top };
    };
    let s = 1;
    let res = place(s);
    if (res.height > areaH) {
      s = areaH / res.height; // 대략 맞추고
      for (let k = 0; k < 20 && place(s).height > areaH; k++) s *= 0.97; // 틈 때문에 넘치면 조금씩 더 줄임
      res = place(s);
    }
    // 마지막 줄에 그림이 하나만 남으면 남은 공간(영역 폭·아래 안내선까지)에 맞게 키워 가운데에 (담당자 수정 2026-10-19:
    // 사진 1장은 영역을 꽉 채우게, 2장+1장이면 세 번째를 아래 공간에 맞게 크게)
    const lastRow = rows[rows.length - 1];
    if (lastRow.length === 1 && s >= 0.999) {
      const p = res.placed.find((q) => q.i === lastRow[0]);
      const im = images[lastRow[0]];
      const roomH = G.yBottom - p.y;
      let w = areaW;
      let h = (w * im.cssHeight) / im.cssWidth;
      if (h > roomH) {
        h = roomH;
        w = (h * im.cssWidth) / im.cssHeight;
      }
      if (w > p.w) Object.assign(p, { w, h, x: G.xImg + (areaW - w) / 2 });
    }
    return { ...res, scale: s };
  }

  // 긴 본문을 여러 단으로: 줄 경계에서 높이가 비슷하게 나누고, 각 단은 글자 끝에서 오른쪽 여백을 자른다.
  // 두 단을 먼저 해 보고(글자 최소 36%), 그래도 안 되면 세 단(최소 30%). 단들이 안내선 안(4.56~18.66cm, 댓글 위)에 들어오게.
  const COL_GAP = 0.4 * CM;
  const SPLIT_TRIES = [
    [2, 0.36],
    [3, 0.3],
  ];
  function splitBody(body, p, y) {
    if (!body.cuts || body.cuts.length < 4 || p.avail < 2 * CM) return null;
    const areaW = G.xRight - G.xBody;
    const H = body.canvas.height;
    const inkW = Math.max(1, body.inkWidth || body.canvas.width);
    const emuPerPx = CSS_PX_EMU / body.dpr;
    for (const [k, minScale] of SPLIT_TRIES) {
      if (body.cuts.length < k * 2) continue;
      // k 단의 경계: 각 목표 높이(H·i/k)에 가장 가까운 줄 경계
      const bounds = [0];
      for (let i = 1; i < k; i++) {
        const target = (H * i) / k;
        let best = body.cuts[0];
        for (const c of body.cuts) if (Math.abs(c - target) < Math.abs(best - target)) best = c;
        if (best <= bounds[bounds.length - 1] || best >= H) break;
        bounds.push(best);
      }
      bounds.push(H);
      if (bounds.length !== k + 1) continue;
      const colMax = (areaW - (k - 1) * COL_GAP) / k;
      const tallest = Math.max(...bounds.slice(1).map((b, i) => b - bounds[i]));
      let scale = Math.min(p.scale, colMax / (inkW * emuPerPx), p.avail / (tallest * emuPerPx));
      if (scale < minScale) continue;
      const w = inkW * emuPerPx * scale;
      return {
        plan: { ...p, scale, fits: true, body: null },
        placements: bounds.slice(0, -1).map((y0, i) => ({
          kind: "body",
          item: body,
          region: { y0, y1: bounds[i + 1], w: inkW },
          x: G.xBody + i * (colMax + COL_GAP),
          y,
          w,
          h: (bounds[i + 1] - y0) * emuPerPx * scale,
        })),
      };
    }
    return null;
  }

  // 본문 글이 없는 글(영상·사진만): 가로로 긴 영상·사진을 본문 자리(4.56~18.66cm, 제목 아래·댓글 위)에
  // 같은 폭으로 한 줄에 1~3개씩. 그림이 가장 크게 들어가는 칸 수를 고르고, 넘치면 같은 비율로 줄인다.
  function layoutBodyMedia(items, top, avail) {
    const areaW = G.xRight - G.xBody;
    let best = null;
    for (let cols = 1; cols <= Math.min(3, items.length); cols++) {
      const w0 = (areaW - (cols - 1) * IMG_GAP) / cols;
      let total = 0;
      for (let r = 0; r < items.length; r += cols) {
        const row = items.slice(r, r + cols);
        total += Math.max(...row.map((im) => (w0 * im.cssHeight) / im.cssWidth)) + (r ? IMG_GAP : 0);
      }
      const s = Math.min(1, avail / total);
      if (!best || w0 * s > best.w * 1.02) best = { cols, w: w0 * s };
    }
    const out = [];
    let y = top;
    for (let r = 0; r < items.length; r += best.cols) {
      const row = items.slice(r, r + best.cols);
      // 가운데 정렬
      let x = G.xBody + (areaW - (row.length * best.w + (row.length - 1) * IMG_GAP)) / 2;
      const hs = row.map((im) => (best.w * im.cssHeight) / im.cssWidth);
      row.forEach((im, k) => {
        out.push({ kind: "image", item: im, x, y, w: best.w, h: hs[k] });
        x += best.w + IMG_GAP;
      });
      y += Math.max(...hs) + IMG_GAP;
    }
    return out;
  }

  // visuals: { header, body, comments: [], images: [] } (각각 ImageProc 결과 또는 null)
  // → { placements: [{ kind, item, x, y, w, h, crop }], scale, dropped }
  function layout(visuals) {
    const placements = [];
    let y = G.yTop;
    if (visuals.header) {
      let w = TITLE_W[0];
      let h = (w * visuals.header.cssHeight) / visuals.header.cssWidth;
      if (h > TITLE_MAX_H) {
        w = TITLE_W[1];
        h = (w * visuals.header.cssHeight) / visuals.header.cssWidth;
      }
      // 제목 영역이 너무 높으면(이상 캡처) 아래를 잘라 슬라이드 밖으로 넘치지 않게
      const crop = h > TITLE_CROP_H ? TITLE_CROP_H / h : 1;
      placements.push({ kind: "header", item: visuals.header, x: G.xText, y, w, h: h * crop, crop });
      y += h * crop + GAP;
    }

    const comments = [...(visuals.comments || [])];
    const plan = (keep, scale) => {
      const cs = comments.slice(0, keep).map((c) => sizeAt(c, scale, G.xRight - G.xText));
      const commentsH = cs.reduce((s, c) => s + c.h, 0) + Math.max(0, cs.length - 1) * GAP;
      const avail = G.yBottom - commentsH - (cs.length ? GAP : 0) - y;
      const body = visuals.body ? sizeAt(visuals.body, scale, G.xRight - G.xBody) : null;
      return { scale, cs, body, avail, fits: !body || body.h <= avail };
    };
    // 담당자가 고른 댓글(최대 2개)은 반드시 모두 넣는다 (2026-10-20 담당자 지적: 2개 골랐는데 1개만 들어감)
    // 안 들어가면: 51% → 46% → 본문을 두 단으로 나눔 → 본문 아래를 자름. 본문 자리가 거의 없을 때만 댓글을 줄인다
    const n = comments.length;
    let chosen = plan(n, SCALES[0]);
    if (!chosen.fits) chosen = plan(n, SCALES[1]);
    let split = null;
    if (!chosen.fits && visuals.body) split = splitBody(visuals.body, chosen, y);
    if (split) {
      chosen = split.plan;
      placements.push(...split.placements);
    } else if (!chosen.fits) {
      for (let k = n; k >= Math.min(1, n); k--) {
        chosen = plan(k, SCALES[1]);
        if (chosen.avail >= 2 * CM) break;
      }
    }
    if (!split && visuals.body && chosen.body && chosen.avail > 0.5 * CM) {
      const b = chosen.body;
      const crop = b.h > chosen.avail ? chosen.avail / b.h : 1;
      placements.push({ kind: "body", item: visuals.body, x: G.xBody, y, w: b.w, h: b.h * crop, crop });
    }
    let cy = G.yBottom;
    for (let k = chosen.cs.length - 1; k >= 0; k--) {
      const c = chosen.cs[k];
      cy -= c.h;
      placements.push({ kind: "comment", item: comments[k], x: G.xText, y: cy, w: c.w, h: c.h });
      cy -= GAP;
    }

    let images = visuals.images || [];
    // 본문 글이 없으면(양식 문구만 있던 글 포함) 사진·영상을 본문 자리로
    //  - 가로로 긴 것: 본문 폭에 맞춰 크게
    //  - 세로로 긴 것: 오른쪽 영역과 같은 크기(2.8cm 폭)로 본문 자리 왼쪽부터 한 줄로 (담당자 수정 2026-10-19)
    if (!visuals.body && images.length && chosen.avail > 1.5 * CM) {
      const wide = images.filter((im) => im.cssWidth >= im.cssHeight);
      const tallOnes = images.filter((im) => im.cssWidth < im.cssHeight);
      let top = y;
      if (wide.length) {
        const placed = layoutBodyMedia(wide, top, chosen.avail);
        placements.push(...placed);
        top = Math.max(...placed.map((p) => p.y + p.h)) + IMG_GAP;
      }
      if (tallOnes.length) {
        if (!wide.length) top = Math.max(G.yImg, y - GAP); // 오른쪽 사진 줄과 같은 높이(8.03cm)에 맞춤
        const areaW = G.xRight - G.xBody;
        const w = (G.xImgR - G.xImg - IMG_GAP) / 2; // 2.8cm
        const perRow = Math.max(1, Math.floor((areaW + 0.25 * CM) / (w + 0.25 * CM)));
        const rowsN = Math.ceil(tallOnes.length / perRow);
        const hMax = Math.max(...tallOnes.map((im) => (w * im.cssHeight) / im.cssWidth));
        const room = y + chosen.avail - top;
        const s = Math.min(1, room / (rowsN * hMax + (rowsN - 1) * IMG_GAP));
        if (room > 1.5 * CM) {
          tallOnes.forEach((im, k) => {
            const r = Math.floor(k / perRow);
            const c = k % perRow;
            const ww = w * s;
            placements.push({ kind: "image", item: im, x: G.xBody + c * (ww + 0.25 * CM), y: top + r * (hMax * s + IMG_GAP), w: ww, h: (ww * im.cssHeight) / im.cssWidth });
          });
          images = images.filter((im) => !tallOnes.includes(im));
        }
      }
      images = images.filter((im) => !wide.includes(im));
    }
    if (images.length) {
      const normal = layoutImagesUniform(images, G.yImg);
      const tall = layoutImagesUniform(images, G.yTop);
      const use = normal.scale >= 0.999 ? normal : tall.scale > normal.scale * 1.1 ? tall : normal; // 크거나 많으면 위로 확장
      for (const p of use.placed) placements.push({ kind: "image", item: images[p.i], x: p.x, y: p.y, w: p.w, h: p.h });
    }
    return { placements, scale: chosen.scale, dropped: comments.length - chosen.cs.length };
  }

  global.Layout = { layout, G, CM };
})(typeof window !== "undefined" ? window : self);
