// 화면 자막 인식에서 "자막처럼 생긴 글자"만 골라내는 도구. 유튜브 탭과 스크립트 화면 양쪽에서 쓴다.
// 하단 자막은 대개 흰색·노란색 글자에 검은 테두리나 어두운 바탕이 있다.
// 그래서 밝은 점 가운데 양쪽이 어두운 점으로 막힌 것(글자 획)만 남기고, 화면 가운데를 지나는 덩어리만 쓴다.
// (밝은 배경, 사진, 흰 바탕 검은 글씨인 댓글 캡처 등은 대부분 걸러진다)
(() => {
  const g = typeof window !== "undefined" ? window : self;
  if (g.captionMask) return;

  // data: ImageData 의 RGBA 배열. r: 어두운 점을 찾는 거리(px).
  // → Uint8Array (1 = 자막 글자 점)
  function captionMask(data, w, h, r) {
    const n = w * h;
    const text = new Uint8Array(n);
    const dark = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const R = data[i * 4];
      const G = data[i * 4 + 1];
      const B = data[i * 4 + 2];
      const lum = 0.299 * R + 0.587 * G + 0.114 * B;
      const sat = Math.max(R, G, B) - Math.min(R, G, B);
      // 1 = 흰색, 2 = 노란색
      text[i] = lum >= 170 && sat <= 80 ? 1 : R >= 170 && G >= 150 && B <= 130 ? 2 : 0;
      dark[i] = lum <= 100 ? 1 : 0;
    }
    // 글자 획은 양쪽이 테두리(또는 어두운 바탕)로 막혀 있다: 왼쪽·오른쪽 모두 r 안에 어두운 점이 있거나,
    // 위·아래 모두 r 안에 있어야 한다. (테두리 바깥 배경은 한쪽에만 어두운 점이 있어 걸러진다)
    const left = new Uint8Array(n);
    const up = new Uint8Array(n);
    const mask = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      let last = -1e9;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (dark[i]) last = x;
        left[i] = x - last <= r ? 1 : 0;
      }
      last = 1e9;
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (dark[i]) last = x;
        if (left[i] && last - x <= r) mask[i] = 1;
      }
    }
    for (let x = 0; x < w; x++) {
      let last = -1e9;
      for (let y = 0; y < h; y++) {
        const i = y * w + x;
        if (dark[i]) last = y;
        up[i] = y - last <= r ? 1 : 0;
      }
      last = 1e9;
      for (let y = h - 1; y >= 0; y--) {
        const i = y * w + x;
        if (dark[i]) last = y;
        if (up[i] && last - y <= r) mask[i] = 1;
      }
    }
    // 자막은 한 가지 색이므로 더 많은 쪽 색(흰색 또는 노란색)만 남긴다 (글자 사이에 갇힌 배경 제거)
    let white = 0;
    let yellow = 0;
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      if (text[i] === 1) white++;
      else if (text[i] === 2) yellow++;
    }
    const color = white >= yellow ? 1 : 2;
    for (let i = 0; i < n; i++) {
      if (text[i] !== color) text[i] = 0;
      mask[i] &= text[i] ? 1 : 0;
    }

    // 영상 압축으로 테두리가 흐려져 끊긴 획을 잇는다: 남긴 점 사이의 r 이하 밝은 점 줄은 채운다.
    const bridge = (idx, len) => {
      let last = -1;
      for (let k = 0; k < len; k++) {
        const i = idx(k);
        if (!text[i]) {
          last = -1;
        } else if (mask[i]) {
          if (last >= 0 && k - last > 1 && k - last <= r) for (let j = last + 1; j < k; j++) mask[idx(j)] = 2;
          last = k;
        }
      }
    };
    for (let y = 0; y < h; y++) bridge((k) => y * w + k, w);
    for (let x = 0; x < w; x++) bridge((k) => k * w + x, h);
    for (let i = 0; i < n; i++) if (mask[i]) mask[i] = 1;
    return mask;
  }

  // 가로로 이어진 글자 덩어리 가운데 화면 가운데를 지나는 것만 남긴다 (옆에 따로 떨어진 효과 글자 제거).
  // gap: 이보다 넓게 떨어지면 다른 덩어리로 본다(px). → 남긴 글자 점 수
  function keepCenterBlock(mask, w, h, gap) {
    const col = new Uint16Array(w);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) col[x] += mask[y * w + x];
    const spans = [];
    let start = -1;
    let end = -1;
    for (let x = 0; x < w; x++) {
      if (col[x] < 2) continue;
      if (start >= 0 && x - end > gap) {
        spans.push([start, end]);
        start = -1;
      }
      if (start < 0) start = x;
      end = x;
    }
    if (start >= 0) spans.push([start, end]);
    const cx = w / 2;
    const tol = w * 0.08;
    const keep = spans.find(([a, b]) => a - tol <= cx && cx <= b + tol);
    let count = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!keep || x < keep[0] || x > keep[1]) mask[i] = 0;
        count += mask[i];
      }
    }
    return count;
  }

  g.captionMask = captionMask;
  g.keepCenterBlock = keepCenterBlock;
})();
