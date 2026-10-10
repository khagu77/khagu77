// 스크립트 추출(화면 자막 인식) - 화면 쪽
// (common.js, caption-mask.js, lib/ocr/ort.wasm.min.js 다음, script.js 앞에 넣는다)
// 유튜브 탭(screen-capture.js)이 보내 준 화면 아래쪽 그림에서 자막처럼 생긴 글자만 남기고(caption-mask.js),
// 줄마다 한국어 글자 인식 모델(PaddleOCR PP-OCRv5 korean, ONNX)로 읽어 "00:00 자막" 줄로 모은다.
// 효과 글자·댓글 캡처·사진 속 글자는 거르고, 한글이 없는 줄(영문 번역 줄 등)은 빼고 한글 줄만 남긴다.

const OCR_BASE = new URL("lib/ocr/", location.href).href;
const OCR_MIN_CONF = 0.5; // 줄 전체를 이보다 자신 없게 읽었으면 버린다 (0~1)
const OCR_HOLD_ON = 8; // 읽을 그림이 이만큼 밀리면 영상을 잠깐 세운다
const OCR_HOLD_OFF = 2;
const HANGUL = /[가-힣]/;

let ocr = null; // { session, chars }

async function ensureOcr(onStatus) {
  if (ocr) return ocr;
  onStatus("글자 인식 엔진 준비 중…");
  ort.env.wasm.wasmPaths = OCR_BASE;
  ort.env.wasm.numThreads = 1;
  const [session, dict] = await Promise.all([
    ort.InferenceSession.create(`${OCR_BASE}korean_rec.onnx`, { executionProviders: ["wasm"] }),
    fetch(`${OCR_BASE}korean_dict.txt`).then((r) => r.text()),
  ]);
  // 사전 한 줄이 글자 하나: 0번(빈 줄)은 "글자 없음", 마지막은 띄어쓰기
  const chars = dict.split("\n");
  chars[chars.length - 1] = " ";
  ocr = { session, chars };
  return ocr;
}

function loadImage(src) {
  const img = new Image();
  img.src = src;
  return img.decode().then(() => img);
}

// 글자 줄 찾기: 글자 점이 있는 행을 묶는다. 빈 행이 하나라도 있으면 다른 줄로 본 뒤(한글·영문 두 줄이
// 바짝 붙어 나와도 나뉘도록), 점·받침 조각처럼 너무 얇은 조각은 가까운 줄에 다시 붙인다. → [[y0, y1], ...]
function findBands(mask, w, h) {
  const rows = new Uint16Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rows[y] += mask[y * w + x] ? 1 : 0;
  let bands = [];
  let y0 = -1;
  for (let y = 0; y <= h; y++) {
    const on = y < h && rows[y] >= 2;
    if (on && y0 < 0) y0 = y;
    if (!on && y0 >= 0) {
      bands.push([y0, y - 1]);
      y0 = -1;
    }
  }
  const tallest = Math.max(0, ...bands.map(([a, b]) => b - a + 1));
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < bands.length; i++) {
      const [a, b] = bands[i];
      if (b - a + 1 >= tallest * 0.45) continue;
      const up = i > 0 ? a - bands[i - 1][1] : Infinity;
      const down = i < bands.length - 1 ? bands[i + 1][0] - b : Infinity;
      if (Math.min(up, down) > tallest * 0.35) continue;
      const j = up <= down ? i - 1 : i + 1;
      bands[j] = [Math.min(a, bands[j][0]), Math.max(b, bands[j][1])];
      bands.splice(i, 1);
      changed = true;
      break;
    }
  }
  return bands.filter(([a, b]) => b - a + 1 >= Math.max(6, tallest * 0.45));
}

// 그림을 키운 뒤 자막 글자 점만 골라 흰 바탕 검은 글씨 그림(masked)을 만들고, 글자 줄 위치를 찾는다.
// region: 그림이 화면 높이에서 차지하는 비율 (글자 크기 짐작용)
// → { masked, plain(키운 원래 그림), soft(글자 주변만 남긴 반전 그림), lines: [{x0,y0,x1,y1}], textPixels, area }
function prepareImage(img, region) {
  const fontPx0 = (0.05 * img.height) / region; // 자막 글자 높이 짐작 (작은 자막 기준 화면 높이의 5%)
  const scale = Math.max(1, Math.min(4, 64 / fontPx0)); // 글자 높이 64px 정도로
  const fontPx = fontPx0 * scale;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const plain = document.createElement("canvas");
  plain.width = w;
  plain.height = h;
  const pctx = plain.getContext("2d", { willReadFrequently: true });
  pctx.imageSmoothingQuality = "high";
  pctx.drawImage(img, 0, 0, w, h);
  const data = pctx.getImageData(0, 0, w, h);
  const mask = captionMask(data.data, w, h, Math.max(2, Math.round(fontPx * 0.15)));
  const textPixels = keepCenterBlock(mask, w, h, Math.round(fontPx * 1.5));

  // 줄을 대강 찾아 줄마다 한 가지 색만 남긴 뒤(글자 사이에 갇힌 배경 제거), 깨끗해진 그림에서 줄을 다시 찾는다.
  const inBand = new Uint8Array(h);
  for (const [a, b] of findBands(mask, w, h)) {
    keepLineColor(mask, w, a, b);
    inBand.fill(1, a, b + 1);
  }
  for (let y = 0; y < h; y++) if (!inBand[y]) mask.fill(0, y * w, (y + 1) * w);
  for (let i = 0; i < mask.length; i++) if (mask[i]) mask[i] = 1;
  const bands = findBands(mask, w, h);

  const masked = document.createElement("canvas");
  masked.width = w;
  masked.height = h;
  const mctx = masked.getContext("2d");
  const out = mctx.createImageData(w, h);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 0 : 255;
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  mctx.putImageData(out, 0, 0);

  // 세 번째 그림: 원래 그림을 반전(밝은 글자 → 검은 글자)하되, 글자 점 가까이만 남기고 나머지는 흰색.
  // 작은 글씨는 글자만 고른 그림에서 획이 끊기기 쉬워, 원래 획 모양을 살린 이 그림이 더 잘 읽힌다.
  const near = new Uint8Array(mask.length);
  const rad = Math.max(2, Math.round(fontPx * 0.08));
  const tmp = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) last = x;
      if (x - last <= rad) tmp[y * w + x] = 1;
    }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) {
      if (mask[y * w + x]) last = x;
      if (last - x <= rad) tmp[y * w + x] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) last = y;
      if (y - last <= rad) near[y * w + x] = 1;
    }
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) last = y;
      if (last - y <= rad) near[y * w + x] = 1;
    }
  }
  const soft = document.createElement("canvas");
  soft.width = w;
  soft.height = h;
  const sctx = soft.getContext("2d");
  const so = sctx.createImageData(w, h);
  const px = data.data;
  for (let i = 0; i < mask.length; i++) {
    const lum = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    const v = near[i] ? 255 - lum : 255;
    so.data[i * 4] = so.data[i * 4 + 1] = so.data[i * 4 + 2] = v;
    so.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(so, 0, 0);

  const lines = [];
  for (const [a, b] of bands) {
    let x0 = w;
    let x1 = -1;
    for (let y = a; y <= b; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
        }
      }
    }
    const pad = Math.round((b - a) * 0.15);
    lines.push({ x0: Math.max(0, x0 - pad), y0: Math.max(0, a - pad), x1: Math.min(w - 1, x1 + pad), y1: Math.min(h - 1, b + pad) });
  }
  return { masked, plain, soft, lines, textPixels, area: w * h };
}

// 한 줄 그림을 모델 입력(높이 48, BGR, -1~1)으로 바꿔 읽는다. → { text, conf }
async function readLine(canvas, box) {
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const W = Math.max(16, Math.min(1600, Math.ceil((bw * 48) / bh)));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = 48;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, box.x0, box.y0, bw, bh, 0, 0, W, 48);
  const px = ctx.getImageData(0, 0, W, 48).data;
  const plane = W * 48;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = (px[i * 4 + 2] / 255 - 0.5) / 0.5; // B
    input[plane + i] = (px[i * 4 + 1] / 255 - 0.5) / 0.5; // G
    input[2 * plane + i] = (px[i * 4] / 255 - 0.5) / 0.5; // R
  }
  const { session, chars } = ocr;
  const res = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, 48, W]) });
  const probs = res[session.outputNames[0]];
  const [, steps, classes] = probs.dims;
  const d = probs.data;
  let text = "";
  let prev = 0;
  let confSum = 0;
  let confN = 0;
  for (let t = 0; t < steps; t++) {
    let best = 0;
    let max = -Infinity;
    for (let k = 0; k < classes; k++) {
      const v = d[t * classes + k];
      if (v > max) {
        max = v;
        best = k;
      }
    }
    if (best !== 0 && best !== prev) {
      confSum += max; // 이미 확률(softmax)로 나온다
      confN++;
      text += chars[best] || "";
    }
    prev = best;
  }
  return { text, conf: confN ? confSum / confN : 0 };
}

function cleanOcrText(text) {
  const words = text
    .replace(/[|_~`{}\[\]<>]/g, " ")
    .split(/\s+/)
    // 기호·낱자(ㄴ, ㅡ 등)만으로 된 조각은 인식 잡음
    .filter((w) => /[가-힣A-Za-z0-9]/.test(w));
  // 앞뒤 끝에 홀로 붙은 영문·숫자 한 글자도 잡음
  const lone = (w) => /^[A-Za-z0-9]$/.test(w.replace(/[^가-힣A-Za-z0-9]/g, ""));
  while (words.length && lone(words[words.length - 1])) words.pop();
  while (words.length && lone(words[0])) words.shift();
  return words
    .join(" ")
    .replace(/^[^가-힣A-Za-z0-9"'(]+|[^가-힣A-Za-z0-9"').!?]+$/g, "")
    .trim();
}

const ocrKey = (s) => s.replace(/[^가-힣A-Za-z0-9]/g, "");

function similar(a, b) {
  a = ocrKey(a);
  b = ocrKey(b);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  // 편집 거리가 긴 쪽의 25% 이하면 같은 자막을 조금 다르게 읽은 것으로 본다
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > Math.max(m, n) * 0.25) return false;
  let prevRow = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++) {
      row[j] = Math.min(prevRow[j] + 1, row[j - 1] + 1, prevRow[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prevRow = row;
  }
  return prevRow[n] <= Math.max(m, n) * 0.25;
}

// 자막 그림 한 장 → { text, conf }. 줄마다 글자만 고른 그림과 원래 그림을 둘 다 읽어 더 자신 있는 쪽을 쓴다.
// 자막 그림 한 장 → { text, conf }. 줄마다 세 가지로 손질한 그림을 읽어 가장 자신 있는 쪽을 쓴다.
async function readCaption(src, region) {
  const img = await loadImage(src);
  const p = prepareImage(img, region);
  if (p.textPixels < p.area * 0.002) return { text: "", conf: 0 }; // 자막 없음
  const texts = [];
  let confSum = 0;
  for (const box of p.lines) {
    const reads = [];
    for (const canvas of [p.soft, p.masked, p.plain]) reads.push(await readLine(canvas, box));
    let r = reads.reduce((a, b) => (b.conf > a.conf ? b : a));
    // 글자는 같고 띄어쓰기만 다르면, 띄어쓰기를 더 많이 찾은 쪽을 쓴다 (붙여 읽기 방지)
    const spaces = (t) => (t.match(/ /g) || []).length;
    for (const t of reads) {
      if (t.text.replace(/ /g, "") === r.text.replace(/ /g, "") && spaces(t.text) > spaces(r.text)) r = t;
    }
    // 한글 줄 안에 섞여 읽힌 영어 단어(소문자가 든 조각)는 뺀다. 숫자·대문자 약어(SUV, 1.6)는 남긴다.
    const text = cleanOcrText(
      r.text
        .split(/\s+/)
        .filter((w) => !/[a-z]/.test(w))
        .join(" "),
    );
    // 한글이 없는 줄(영문 번역 등)은 빼고, 한글 줄만 남긴다
    if (r.conf < OCR_MIN_CONF || !HANGUL.test(text)) continue;
    texts.push(text);
    confSum += r.conf;
  }
  return texts.length ? { text: texts.join(" "), conf: confSum / texts.length } : { text: "", conf: 0 };
}

class ScreenJob {
  constructor(region, onUpdate, onHold) {
    this.region = region;
    this.onUpdate = onUpdate;
    this.onHold = onHold;
    this.lines = [];
    this.frames = [];
    this.pump = null;
    this.held = false;
    this.stopped = false;
    this.error = null;
    this.lastT = 0;
  }

  get waiting() {
    return this.frames.length + (this.pump ? 1 : 0);
  }

  push(t, image) {
    this.frames.push({ t, image });
    this.hold();
    this.run();
  }

  hold() {
    const want = this.held ? this.waiting > OCR_HOLD_OFF : this.waiting >= OCR_HOLD_ON;
    if (want !== this.held) {
      this.held = want;
      this.onHold(want);
    }
  }

  add(t, text, conf) {
    const prev = this.lines[this.lines.length - 1];
    if (prev && similar(prev.text, text)) {
      // 같은 자막을 다시 읽은 것 - 더 잘 읽힌 쪽 글자를 남기고 시각은 처음 것
      if (conf > prev.conf) Object.assign(prev, { text, conf });
      return;
    }
    this.lines.push({ t, text, conf });
  }

  run() {
    if (this.pump || this.error) return;
    this.pump = (async () => {
      while (this.frames.length && !this.stopped) {
        const f = this.frames.shift();
        try {
          const r = await readCaption(f.image, this.region);
          if (r.text) this.add(f.t, r.text, r.conf);
        } catch (e) {
          this.error = new Error(`글자 인식 실패: ${e.message}`);
          return;
        } finally {
          this.hold();
          this.onUpdate();
        }
      }
    })().finally(() => {
      this.pump = null;
      this.hold();
    });
  }

  async drain() {
    while (this.pump) await this.pump;
    if (this.error) throw this.error;
  }
}

async function readScreenVideo(videoId, row, index, opts, result) {
  await ensureOcr((t) => setRowStatus(row, t));

  let duration = 0;
  let recording = true;
  let port = null;
  const job = new ScreenJob(
    opts.region,
    () => {
      if (selected === index) showResult(index);
      status();
    },
    (on) => port && port.postMessage({ type: "hold", on }),
  );
  result.lines = job.lines;
  function status() {
    const rec = recording ? `화면 자막 읽는 중 ${fmtTime(job.lastT)} / ${fmtTime(duration)}` : "글자 읽기 마무리 중";
    const waiting = job.waiting;
    setRowStatus(row, `${rec} · ${job.lines.length}줄${waiting ? ` · 읽기 대기 ${waiting}장` : ""}`);
  }

  setRowStatus(row, "유튜브 탭 여는 중…");
  try {
    await runInYoutubeTab({
      videoId,
      files: ["screen-capture.js"],
      portName: "screen",
      start: { speed: opts.speed, region: opts.region },
      mute: true,
      highQuality: true,
      onMessage(m, p) {
        port = p;
        if (m.type === "info") {
          result.title = m.title;
          duration = m.duration;
          setRowTitle(row, m.title);
          if (selected === index) showResult(index);
        } else if (m.type === "status") {
          setRowStatus(row, m.text);
        } else if (m.type === "needplay") {
          setRowStatus(row, "유튜브 탭에서 재생 버튼(▶)을 한 번 눌러 주세요", "err");
        } else if (m.type === "progress") {
          job.lastT = m.t;
          status();
        } else if (m.type === "frame") {
          if (job.error) throw job.error;
          job.lastT = Math.max(job.lastT, m.t);
          job.push(m.t, m.image);
          status();
        } else if (m.type === "done") {
          return true;
        }
        return false;
      },
    });
  } catch (e) {
    job.stopped = true;
    throw e;
  } finally {
    port = null;
  }

  recording = false;
  status();
  await new Promise((resolve, reject) => {
    abortDrain = () => {
      job.stopped = true;
      reject(new Error("중지됨"));
    };
    job.drain().then(resolve, reject);
  });
  abortDrain = null;
}
