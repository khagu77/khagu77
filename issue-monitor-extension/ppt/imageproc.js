// 캡처 이미지 다듬기
// - compactText: 글자가 있는 줄만 남기고 줄 사이 빈 공간을 일정 간격으로 줄여 붙인다 (한 줄씩 띄어 쓴 글 → 촘촘하게).
//   위아래 가로 테두리 선과 좌우 여백도 잘라낸다.
// - cropHeight: 정해진 높이에 맞게 줄 경계에서 아래를 자른다.
// - encodeAtPpi: 슬라이드에 놓일 크기(cm) 기준 150ppi 로 줄여 저장 (용량 줄이기).
(function (global) {
  const LINE_GAP_CSS = 5; // 줄여 붙일 때 줄 사이 간격 (화면 px)
  const PAD_CSS = 3; // 잘라낸 뒤 남기는 가장자리 여백 (화면 px)
  // 배경색과 이만큼 다르면 내용으로 본다. 연한 회색 기본 프로필 아이콘(동그라미)도 잘리지 않게 낮게 잡는다.
  const INK_DIFF = 12;

  async function toBitmap(blob) {
    return createImageBitmap(blob);
  }

  function canvasOf(w, h) {
    const c = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
    return c;
  }

  // bitmap → { canvas, cuts: [줄 끝 y...], cssWidth, cssHeight }
  function compactText(bitmap, dpr, { collapse = true } = {}) {
    const w = bitmap.width;
    const h = bitmap.height;
    const src = canvasOf(w, h);
    const sctx = src.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(bitmap, 0, 0);
    const px = sctx.getImageData(0, 0, w, h).data;
    // 배경색: 네 귀퉁이 중 가장 밝은 색
    const corners = [0, w - 1, (h - 1) * w, h * w - 1].map((i) => [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]);
    const bg = corners.sort((a, b) => b[0] + b[1] + b[2] - (a[0] + a[1] + a[2]))[0];
    const isInk = (i) =>
      Math.max(Math.abs(px[i] - bg[0]), Math.abs(px[i + 1] - bg[1]), Math.abs(px[i + 2] - bg[2])) > INK_DIFF;

    const rowInk = new Uint32Array(h);
    for (let y = 0; y < h; y++) {
      let n = 0;
      for (let x = 0; x < w; x++) if (isInk((y * w + x) * 4)) n++;
      rowInk[y] = n;
    }
    // 폭 대부분을 덮는 가로선(칸 구분선·테두리)은 줄 단위로 지운다 — 단, 얇은 선(3px×배율 이하)만.
    // 배경색(형광펜)이 칠해진 긴 글줄도 폭 대부분이 '잉크'라서 예전엔 줄째 지워졌다 (담당자 지적 2026-10-22: GV80 멤버스 gruu/1756933 본문 두 줄 빠짐)
    for (let y = 0; y < h; ) {
      if (rowInk[y] <= w * 0.8) {
        y++;
        continue;
      }
      let e = y;
      while (e < h && rowInk[e] > w * 0.8) e++;
      if (e - y <= 3 * dpr) for (let k = y; k < e; k++) rowInk[k] = 0;
      y = e;
    }
    // 잉크 줄 묶음(band) 찾기
    let bands = [];
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const ink = y < h && rowInk[y] > 0;
      if (ink && start < 0) start = y;
      if (!ink && start >= 0) {
        bands.push([start, y]);
        start = -1;
      }
    }
    // 가로 테두리 선(폭 대부분을 덮는 얇은 줄) 제거
    bands = bands.filter(([a, b]) => {
      if (b - a > 3 * dpr) return true;
      let maxRow = 0;
      for (let y = a; y < b; y++) maxRow = Math.max(maxRow, rowInk[y]);
      return maxRow < w * 0.8;
    });
    // 맨 위의 얇은 가로줄(짧은 구분선)은 뺀다 — 담당자가 매번 잘라내던 부분 (2026-10-19)
    if (collapse && bands.length > 1 && bands[0][1] - bands[0][0] <= 3 * dpr) bands.shift();
    if (!bands.length) return null;

    // 글자가 시작하는 왼쪽 위치
    let minX = w;
    for (const [a, b] of bands) {
      for (let y = a; y < b; y++) {
        if (!rowInk[y]) continue;
        for (let x = 0; x < minX; x++) {
          if (isInk((y * w + x) * 4)) {
            minX = x;
            break;
          }
        }
      }
    }
    // 왼쪽은 글자 시작에 맞춰 자르고(안내선 정렬), 오른쪽은 게시글 영역 폭을 그대로 둔다.
    // (영역 폭이 같아야 15cm·51% 로 놓았을 때 게시물마다 글자 크기가 같다)
    const pad = Math.round(PAD_CSS * dpr);
    const left = Math.max(0, minX - pad);
    const right = w;
    // 줄 사이 간격: 원래 글의 자연스러운 줄 간격(글자 높이의 약 절반)으로. 빈 줄만 없애고 너무 빡빡하게 붙이지 않는다.
    const heights = bands.map(([a, b]) => b - a).sort((p, q) => p - q);
    const medianH = heights[Math.floor(heights.length / 2)] || 10 * dpr;
    const gapMax = Math.max(Math.round(LINE_GAP_CSS * dpr), Math.round(medianH * 0.5));
    // 글자가 끝나는 오른쪽 위치 (두 단으로 나눌 때 오른쪽 여백을 잘라내기 위해)
    let maxX = -1;
    for (const [a, b] of bands) {
      for (let y = a; y < b; y++) {
        if (!rowInk[y]) continue;
        for (let x = w - 1; x > maxX; x--) {
          if (isInk((y * w + x) * 4)) {
            maxX = x;
            break;
          }
        }
      }
    }

    // 새 높이 계산 후 붙이기
    const pieces = [];
    let outY = pad;
    for (let k = 0; k < bands.length; k++) {
      const [a, b] = bands[k];
      if (k > 0) {
        const gap = a - bands[k - 1][1];
        outY += collapse ? Math.min(gap, gapMax) : gap;
      }
      pieces.push({ a, b, y: outY });
      outY += b - a;
    }
    const outH = outY + pad;
    const out = canvasOf(right - left, outH);
    const ctx = out.getContext("2d");
    ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
    ctx.fillRect(0, 0, out.width, out.height);
    for (const p of pieces) ctx.drawImage(src, left, p.a, right - left, p.b - p.a, 0, p.y, right - left, p.b - p.a);
    return {
      canvas: out,
      cuts: pieces.map((p) => p.y + (p.b - p.a) + pad),
      cssWidth: out.width / dpr,
      cssHeight: out.height / dpr,
      inkWidth: Math.min(out.width, maxX + 1 + pad - left), // 글자가 실제로 있는 폭(px)
      dpr,
    };
  }

  // 일부 영역(위 y0 ~ 아래 y1, 왼쪽부터 폭 w)만 잘라낸 새 항목
  function region(item, y0, y1, w) {
    const out = canvasOf(w, y1 - y0);
    out.getContext("2d").drawImage(item.canvas, 0, y0, w, y1 - y0, 0, 0, w, y1 - y0);
    return { ...item, canvas: out, cuts: [out.height], cssWidth: w / item.dpr, cssHeight: out.height / item.dpr };
  }

  // 줄 경계에서 maxPx 높이 이하로 자르기
  function cropHeight(item, maxPx) {
    if (item.canvas.height <= maxPx) return item;
    const cut = item.cuts.filter((y) => y <= maxPx).pop() || maxPx;
    const out = canvasOf(item.canvas.width, cut);
    out.getContext("2d").drawImage(item.canvas, 0, 0);
    return { ...item, canvas: out, cuts: item.cuts.filter((y) => y <= cut), cssHeight: cut / item.dpr };
  }

  // 사진: 원본 파일이면 픽셀 그대로(비율 유지), 화면 캡처면 해상도 배율(dpr)로 크기 환산
  function photo(bitmap, dpr, isOriginal = false) {
    const c = canvasOf(bitmap.width, bitmap.height);
    c.getContext("2d").drawImage(bitmap, 0, 0);
    const k = isOriginal ? 1 : dpr;
    return { canvas: c, cuts: [c.height], cssWidth: c.width / k, cssHeight: c.height / k, dpr: k };
  }

  // 영상 캡처: 가장자리의 한 가지 색 테두리(흰 여백, 세로 영상 양옆 검은 띠)를 잘라 영상 화면 폭에 딱 맞게
  function trimBorders(item) {
    const c = item.canvas;
    const w = c.width;
    const h = c.height;
    const px = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const at = (x, y) => (y * w + x) * 4;
    // 테두리로 보는 색: 흰색에 가깝거나(여백) 검은색에 가까운(영상 양옆 띠) 색만 — 영상 화면 자체는 자르지 않게
    const edgeColor = (i) => (px[i] > 225 && px[i + 1] > 225 && px[i + 2] > 225) || (px[i] < 35 && px[i + 1] < 35 && px[i + 2] < 35);
    const near = (i, ref) => edgeColor(ref) && Math.max(Math.abs(px[i] - px[ref]), Math.abs(px[i + 1] - px[ref + 1]), Math.abs(px[i + 2] - px[ref + 2])) <= 24;
    // 한 줄(행·열)이 기준 색과 거의(98%) 같으면 테두리
    const colFlat = (x, ref, y0, y1) => {
      let n = 0;
      for (let y = y0; y < y1; y++) if (near(at(x, y), ref)) n++;
      return n >= (y1 - y0) * 0.98;
    };
    let top = 0;
    let bottom = h;
    let left = 0;
    let right = w;
    const rowFlatIn = (y, ref) => {
      let n = 0;
      for (let x = left; x < right; x++) if (near(at(x, y), ref)) n++;
      return n >= (right - left) * 0.98;
    };
    // 흰 여백 → 검은 띠처럼 테두리가 겹겹이면 더 잘리지 않을 때까지 되풀이
    for (let pass = 0; pass < 4; pass++) {
      const before = [top, bottom, left, right].join();
      while (top < bottom - 1 && rowFlatIn(top, at(left, top))) top++;
      while (bottom > top + 1 && rowFlatIn(bottom - 1, at(left, bottom - 1))) bottom--;
      while (left < right - 1 && colFlat(left, at(left, top), top, bottom)) left++;
      while (right > left + 1 && colFlat(right - 1, at(right - 1, top), top, bottom)) right--;
      if ([top, bottom, left, right].join() === before) break;
    }
    const nw = right - left;
    const nh = bottom - top;
    if (nw < w * 0.15 || nh < h * 0.3 || (nw === w && nh === h)) return item; // 너무 많이 잘리면(이상) 그대로
    const out = canvasOf(nw, nh);
    out.getContext("2d").drawImage(c, left, top, nw, nh, 0, 0, nw, nh);
    return { ...item, canvas: out, cuts: [nh], cssWidth: nw / item.dpr, cssHeight: nh / item.dpr };
  }

  // 슬라이드에 놓일 크기(cm) 기준 ppi 로 줄여서 PNG/JPEG Blob 으로
  async function encodeAtPpi(canvas, widthCm, heightCm, { ppi = 330, type = "image/png" } = {}) {
    // 가로 기준으로 줄이고 세로는 원본 비율 그대로 (임의로 찌그러뜨리지 않음)
    const tw = Math.max(1, Math.round((widthCm / 2.54) * ppi));
    const th = Math.max(1, Math.round((tw * canvas.height) / canvas.width));
    let src = canvas;
    // 크게 한 번에 줄이면 글자가 뭉개지므로 절반씩 단계적으로 고품질로 줄인다
    while (src.width > tw) {
      const w = Math.max(tw, Math.round(src.width / 2));
      const h = w === tw ? th : Math.max(1, Math.round((src.height * w) / src.width));
      const next = canvasOf(w, h);
      const ctx = next.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(src, 0, 0, w, h);
      src = next;
    }
    const blob = await src.convertToBlob(type === "image/jpeg" ? { type, quality: 0.92 } : { type });
    return { blob, width: src.width, height: src.height };
  }

  async function previewUrl(canvas) {
    return URL.createObjectURL(await canvas.convertToBlob({ type: "image/png" }));
  }

  global.ImageProc = { toBitmap, compactText, cropHeight, region, photo, trimBorders, encodeAtPpi, previewUrl };
})(typeof window !== "undefined" ? window : self);
