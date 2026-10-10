// 스크립트 추출(화면 자막 인식) - 화면 쪽
// (common.js, caption-mask.js, lib/tesseract/tesseract.min.js 다음, script.js 앞에 넣는다)
// 유튜브 탭(screen-capture.js)이 보내 준 화면 아래쪽 그림에서 자막처럼 생긴 글자만 남겨 Tesseract 로 읽고,
// 가운데 정렬된 줄만 "00:00 자막" 줄로 모은다. (효과 글자·댓글 캡처·사진 속 글자는 거른다)

const OCR_MIN_CONF = 45; // 이보다 자신 없게 읽힌 글자는 버린다
const OCR_CENTER = 0.2; // 줄 가운데가 화면 가운데에서 폭의 20% 안에 있어야 자막으로 본다
const OCR_HOLD_ON = 8; // 읽을 그림이 이만큼 밀리면 영상을 잠깐 세운다
const OCR_HOLD_OFF = 2;

let ocrWorker = null;

async function ensureOcr(onStatus) {
  if (ocrWorker) return ocrWorker;
  onStatus("글자 인식 엔진 준비 중…");
  const base = new URL("lib/tesseract/", location.href).href;
  const w = await Tesseract.createWorker("kor+eng", 1, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: `${base}lang`,
    workerBlobURL: false,
    gzip: true,
    cacheMethod: "none",
  });
  await w.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
  ocrWorker = w;
  return w;
}

function loadImage(src) {
  const img = new Image();
  img.src = src;
  return img.decode().then(() => img);
}

// 그림을 읽기 좋게 키운 뒤, 자막 글자 점만 검은색·나머지는 흰색으로 만든다.
// region: 그림이 화면 높이에서 차지하는 비율 (글자 크기 짐작용)
function prepareImage(img, region) {
  const fontPx0 = (0.07 * img.height) / region; // 자막 글자 높이 짐작 (화면 높이의 7%)
  const scale = Math.max(1, Math.min(4, 80 / fontPx0)); // 글자 높이 80px 정도로
  const fontPx = fontPx0 * scale;
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const mask = captionMask(data.data, c.width, c.height, Math.max(2, Math.round(fontPx * 0.12)));
  c.textPixels = keepCenterBlock(mask, c.width, c.height, Math.round(fontPx * 1.2));
  c.area = c.width * c.height;
  const px = data.data;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 0 : 255;
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v;
    px[i * 4 + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return c;
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

async function readCaption(worker, src, region) {
  const img = await loadImage(src);
  const c = prepareImage(img, region);
  if (c.textPixels < c.area * 0.002) return { text: "", conf: 0 }; // 자막 없음
  const { data } = await worker.recognize(c);
  // 가운데 정렬된 줄만 자막으로 본다
  const lines = (data.lines || []).filter((l) => {
    const cx = (l.bbox.x0 + l.bbox.x1) / 2;
    return Math.abs(cx - c.width / 2) <= c.width * OCR_CENTER && l.confidence >= OCR_MIN_CONF;
  });
  const text = cleanOcrText(lines.map((l) => l.text).join(" "));
  const conf = lines.length ? lines.reduce((a, l) => a + l.confidence, 0) / lines.length : 0;
  return ocrKey(text).length >= 2 ? { text, conf } : { text: "", conf: 0 };
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
          const r = await readCaption(ocrWorker, f.image, this.region);
          if (r.conf >= OCR_MIN_CONF) this.add(f.t, r.text, r.conf);
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
