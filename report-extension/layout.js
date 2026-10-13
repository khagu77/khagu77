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
    return { ...res, scale: s };
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
    // 안 들어가면: 51% → 46% → 댓글 수 줄이기(1개까지) → 그래도 안 되면 댓글 2개 두고 본문 아래를 자름
    const n = comments.length;
    const tries = [[n, SCALES[0]], [n, SCALES[1]]];
    for (let k = n - 1; k >= Math.min(1, n); k--) tries.push([k, SCALES[1]]);
    let chosen = null;
    for (const [k, s] of tries) {
      chosen = plan(k, s);
      if (chosen.fits) break;
    }
    if (!chosen.fits) chosen = plan(Math.min(2, n), SCALES[1]);
    if (visuals.body && chosen.body && chosen.avail > 0.5 * CM) {
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

    const images = visuals.images || [];
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
