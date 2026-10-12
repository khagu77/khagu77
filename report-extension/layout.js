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

  // 오른쪽 이미지 격자: 칸 수를 바꿔 가며 그림이 가장 크게 들어가는 배치를 고른다
  function layoutImages(images, top) {
    const areaW = G.xImgR - G.xImg;
    const areaH = G.yBottom - top;
    let best = null;
    for (let cols = 1; cols <= Math.min(3, images.length); cols++) {
      const rows = Math.ceil(images.length / cols);
      const cellW = (areaW - (cols - 1) * IMG_GAP) / cols;
      const cellH = (areaH - (rows - 1) * IMG_GAP) / rows;
      const boxes = images.map((im, i) => {
        const s = Math.min(cellW / im.cssWidth, cellH / im.cssHeight);
        return { i, w: im.cssWidth * s, h: im.cssHeight * s, col: i % cols, row: Math.floor(i / cols) };
      });
      const area = boxes.reduce((s, b) => s + b.w * b.h, 0);
      if (!best || area > best.area) best = { area, boxes, cols, cellW };
    }
    // 줄마다 그 줄의 가장 큰 그림 높이만큼만 쓰고 위로 붙인다
    const out = [];
    let y = top;
    const rows = Math.ceil(images.length / best.cols);
    for (let r = 0; r < rows; r++) {
      const row = best.boxes.filter((b) => b.row === r);
      const rowW = row.reduce((s, b) => s + b.w, 0) + (row.length - 1) * IMG_GAP;
      let x = G.xImg + (areaW - rowW) / 2;
      for (const b of row) {
        out.push({ i: b.i, x, y, w: b.w, h: b.h });
        x += b.w + IMG_GAP;
      }
      y += Math.max(...row.map((b) => b.h)) + IMG_GAP;
    }
    return { placed: out, area: best.area };
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
      const normal = layoutImages(images, G.yImg);
      const tall = layoutImages(images, G.yTop);
      const use = tall.area > normal.area * 1.3 ? tall : normal; // 크거나 많으면 위로 확장
      for (const p of use.placed) placements.push({ kind: "image", item: images[p.i], x: p.x, y: p.y, w: p.w, h: p.h });
    }
    return { placements, scale: chosen.scale, dropped: comments.length - chosen.cs.length };
  }

  global.Layout = { layout, G, CM };
})(typeof window !== "undefined" ? window : self);
