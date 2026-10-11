// 스크립트 추출 - 화면 (common.js, screen.js 다음에 넣는다)
// 유튜브 스크립트 가져오기: 영상 페이지에서 설명란 '…더보기' → '스크립트 표시'를 눌러 오른쪽 스크립트 패널의 줄을 읽는다.
//   스크립트가 없는 영상은 화면 자막 인식/음성 인식으로 수집하도록 안내하거나(물어보기) 자동으로 넘어간다.
// 음성 인식: 영상을 유튜브 탭에서 재생하고(script-capture.js), 받은 소리를 30초 안쪽 구간으로 잘라
// 음성인식 작업자(script-worker.js)로 받아쓴 뒤 "00:00 스크립트 내용" 줄로 모은다.
// 화면 자막 인식: screen.js 참고.

const SR = 16000;
const MIN_WIN = 18; // 구간은 18~28초 사이에서 가장 조용한 곳을 잘라 만든다 (Whisper 는 30초 단위)
const MAX_WIN = 28;
const GAP_TOL = 1.5; // 영상 시각이 이만큼(초) 어긋나면(광고·되감기) 구간을 끊는다
const SILENCE_RMS = 0.004; // 이보다 조용한 구간은 받아쓰지 않는다 (무음에서 엉뚱한 문장이 나오는 것 방지)
const MUTE_CHECK_SEC = 8;

const MODELS = {
  turbo: {
    id: "onnx-community/whisper-large-v3-turbo",
    label: "가장 정확 (large-v3-turbo, 처음 약 1.5GB 내려받음)",
    gpuOnly: true,
    webgpu: { encoder_model: "fp16", decoder_model_merged: "q4" },
  },
  small: {
    id: "onnx-community/whisper-small",
    label: "보통 (small, 처음 약 300MB 내려받음)",
    webgpu: { encoder_model: "fp32", decoder_model_merged: "q4" },
    wasm: "q8",
  },
  base: {
    id: "onnx-community/whisper-base",
    label: "빠름 (base, 정확도 낮음)",
    webgpu: { encoder_model: "fp32", decoder_model_merged: "q4" },
    wasm: "q8",
  },
};

function scriptText(lines) {
  return lines.map((l) => `${fmtTime(l.t)} ${l.text}`).join("\n");
}

function decodePcm(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const f32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 0x8000;
  return f32;
}

function rms(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / (a.length || 1));
}

function downloadText(text, name) {
  // 메모장에서 그대로 열리도록 Windows 줄바꿈(CRLF) + UTF-8 BOM
  const blob = new Blob(["\ufeff" + text.replace(/\n/g, "\r\n") + "\r\n"], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---------------------------------------------------------------------------
// 음성인식 작업자
// ---------------------------------------------------------------------------

let gpu = null; // { f16 } - WebGPU 를 쓸 수 있으면
let worker = null;
let workerKey = null;
let nextReqId = 1;
const pendingReqs = new Map();

async function detectGpu() {
  if (!navigator.gpu) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter ? { f16: adapter.features.has("shader-f16") } : null;
  } catch {
    return null;
  }
}

function onWorkerMessage({ data }) {
  const req = pendingReqs.get(data.id);
  if (!req) return;
  pendingReqs.delete(data.id);
  if (data.type === "result") req.resolve(data.chunks);
  else req.reject(new Error(data.message));
}

async function ensureModel(key, onStatus) {
  if (worker && workerKey === key) return;
  if (worker) worker.terminate();
  worker = new Worker("script-worker.js", { type: "module" });
  workerKey = null;
  const m = MODELS[key];
  let dtype = gpu ? { ...m.webgpu } : m.wasm;
  if (gpu && !gpu.f16 && dtype.encoder_model === "fp16") dtype.encoder_model = "fp32";
  const files = {};
  onStatus("음성인식 모델 준비 중…");
  try {
    await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.type === "progress") {
          files[data.file] = data;
          let loaded = 0;
          let total = 0;
          for (const f of Object.values(files)) {
            loaded += f.loaded || 0;
            total += f.total || 0;
          }
          const mb = (n) => Math.round(n / 1e6);
          onStatus(`음성인식 모델 내려받는 중… ${mb(loaded)} / ${mb(total)}MB (처음 한 번만)`);
        } else if (data.type === "ready") resolve();
        else if (data.type === "error") reject(new Error(data.message));
      };
      worker.onerror = (e) => reject(new Error(e.message || "음성인식 작업자를 시작하지 못했습니다"));
      worker.postMessage({ type: "load", model: m.id, device: gpu ? "webgpu" : "wasm", dtype });
    });
  } catch (e) {
    worker.terminate();
    worker = null;
    throw new Error(`음성인식 모델을 불러오지 못했습니다: ${e.message}`);
  }
  worker.onmessage = onWorkerMessage;
  workerKey = key;
}

function recognize(audio) {
  return new Promise((resolve, reject) => {
    const id = nextReqId++;
    pendingReqs.set(id, { resolve, reject });
    worker.postMessage({ type: "run", id, audio }, [audio.buffer]);
  });
}

// ---------------------------------------------------------------------------
// 영상 하나: 소리 받기 → 구간 자르기 → 받아쓰기
// ---------------------------------------------------------------------------

class VideoJob {
  constructor(speed, onUpdate) {
    this.speed = speed;
    this.onUpdate = onUpdate;
    this.epoch = 0;
    this.lines = [];
    this.reset();
  }

  reset() {
    this.buf = new Float32Array(SR * 40);
    this.len = 0;
    this.startT = 0;
    this.windows = [];
    this.lines.length = 0;
    this.received = 0;
    this.peak = 0;
    this.lastT = 0;
    this.pump = null;
    this.stopped = false;
    this.error = null;
  }

  expectedT() {
    return this.startT + (this.len / SR) * this.speed;
  }

  push(t, audio) {
    if (this.len && Math.abs(t - this.expectedT()) > GAP_TOL) this.cut(this.len);
    if (!this.len) this.startT = t;
    this.buf.set(audio, this.len);
    this.len += audio.length;
    this.received += audio.length;
    for (let i = 0; i < audio.length; i++) this.peak = Math.max(this.peak, Math.abs(audio[i]));
    this.lastT = t + (audio.length / SR) * this.speed;
    while (this.len >= MAX_WIN * SR) this.cut(this.quietestCut());
  }

  // MIN_WIN~MAX_WIN 사이에서 0.1초 단위로 가장 조용한 곳 (말 중간을 자르지 않도록)
  quietestCut() {
    const frame = SR / 10;
    let best = MAX_WIN * SR;
    let bestE = Infinity;
    for (let s = MIN_WIN * SR; s + frame <= MAX_WIN * SR; s += frame / 2) {
      let e = 0;
      for (let i = s; i < s + frame; i++) e += this.buf[i] * this.buf[i];
      if (e < bestE) {
        bestE = e;
        best = s + frame / 2;
      }
    }
    return best;
  }

  cut(n) {
    if (n >= SR * 0.3) this.windows.push({ start: this.startT, audio: this.buf.slice(0, n) });
    this.buf.copyWithin(0, n, this.len);
    this.len -= n;
    this.startT += (n / SR) * this.speed;
    this.run();
  }

  flush() {
    if (this.len) this.cut(this.len);
  }

  run() {
    if (this.pump || this.error) return;
    this.pump = (async () => {
      while (this.windows.length && !this.stopped) {
        const w = this.windows.shift();
        if (rms(w.audio) < SILENCE_RMS) continue;
        let chunks;
        try {
          chunks = await recognize(w.audio);
        } catch (e) {
          this.error = new Error(`받아쓰기 실패: ${e.message}`);
          this.onUpdate();
          return;
        }
        for (const c of chunks) {
          const text = c.text.trim();
          const prev = this.lines[this.lines.length - 1];
          if (!text || (prev && prev.text === text)) continue; // 같은 문장 반복(인식 오류) 제거
          this.lines.push({ t: w.start + c.start * this.speed, text });
        }
        this.onUpdate();
      }
    })().finally(() => {
      this.pump = null;
    });
  }

  async drain() {
    while (this.pump) await this.pump;
    if (this.error) throw this.error;
  }
}

// ---------------------------------------------------------------------------
// 유튜브 스크립트 가져오기
// ---------------------------------------------------------------------------

class NoTranscriptError extends Error {}

const MODE_LABEL = { screen: "화면 자막 인식", speech: "음성 인식" };
const DEFAULT_SPEED = { screen: 3, speech: 1 };

// "1:02:03" → 3723
function parseClock(s) {
  const parts = String(s || "").trim().split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((a, b) => a * 60 + b, 0);
}

// 유튜브 탭 안에서 실행 (확장 바깥 함수는 쓸 수 없음):
// 설명란 '…더보기' → '스크립트 표시' → 오른쪽 스크립트 패널의 [시간, 내용] 줄을 돌려준다.
async function grabTranscriptInPage() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(300);
    }
    return null;
  };
  const text = (el) => (el ? (el.innerText || el.textContent || "").trim() : "");
  const getTitle = () => text(document.querySelector("h1.ytd-watch-metadata, #title h1")) || document.title.replace(/ - YouTube$/, "");
  const isShowTranscript = (el) => /스크립트\s*표시|show transcript/i.test(`${el.getAttribute("aria-label") || ""} ${text(el)}`);
  const SEGMENTS = "ytd-transcript-segment-renderer, transcript-segment-view-model";
  const segments = () => document.querySelectorAll(SEGMENTS);

  // 소리 없이, 영상은 멈춰 둔다 (스크립트만 읽으면 되므로)
  const stopVideo = () => document.querySelectorAll("video").forEach((v) => { v.muted = true; v.pause(); });
  await until(() => document.querySelector("#description, #description-inline-expander, ytd-watch-metadata"), 20000);
  stopVideo();

  if (!segments().length) {
    // 1) 설명란 '…더보기'
    const expand = document.querySelector("#description-inline-expander #expand, ytd-text-inline-expander #expand, tp-yt-paper-button#expand, #expand");
    if (expand) {
      expand.click();
      await sleep(800);
    }
    // 2) 설명란 아래 '스크립트 표시'
    let btn = await until(() => {
      const section = document.querySelector("ytd-video-description-transcript-section-renderer");
      const pool = section ? section.querySelectorAll("button, [role=button]") : document.querySelectorAll("#description button, ytd-watch-metadata button");
      return [...pool].find(isShowTranscript);
    }, 8000);
    // 2-1) 예전 화면: 영상 아래 '…'(추가 작업) 메뉴의 '스크립트 표시'
    if (!btn) {
      const more = document.querySelector("ytd-watch-metadata #button-shape button, ytd-menu-renderer yt-button-shape button[aria-label]");
      if (more) {
        more.click();
        btn = await until(() => [...document.querySelectorAll("ytd-menu-service-item-renderer, tp-yt-paper-item")].find(isShowTranscript), 3000);
      }
    }
    if (!btn) {
      stopVideo();
      return { title: getTitle(), lines: [] };
    }
    btn.click();
  }

  // 3) 오른쪽 스크립트 패널의 줄 (늦게 그려지는 줄까지 끝으로 굴려 가며 모두)
  if (!(await until(() => segments().length, 15000))) {
    stopVideo();
    return { title: getTitle(), lines: [] };
  }
  let count = 0;
  for (let k = 0; k < 30; k++) {
    const all = segments();
    if (all.length === count) break;
    count = all.length;
    all[all.length - 1].scrollIntoView({ block: "end" });
    await sleep(500);
  }
  stopVideo();
  const lines = [];
  for (const seg of segments()) {
    let time = text(seg.querySelector(".segment-timestamp, [class*='Timestamp'], [class*='timestamp']"));
    let body = text(seg.querySelector(".segment-text, [class*='SegmentText'], [class*='segment-text']"));
    if (!time || !body) {
      const parts = text(seg).split("\n").map((t) => t.trim()).filter(Boolean);
      time = time || parts.find((t) => /^\d+(:\d{2})+$/.test(t)) || "";
      body = body || parts.filter((t) => t !== time).join(" ");
    }
    if (time && body) lines.push({ time, text: body.replace(/\s+/g, " ") });
  }
  return { title: getTitle(), lines };
}

// 영상 페이지를 백그라운드 탭(화면이 바뀌지 않음)으로 열어 스크립트를 읽는다.
// 화면이 늦게 그려져 '스크립트 표시'를 못 찾는 경우가 있어, 못 찾으면 새로고침해서 한 번 더 시도한다.
async function readYoutubeTranscript(videoId, row, result) {
  setRowStatus(row, "유튜브 영상 페이지 여는 중… (백그라운드)");
  const tab = await chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}`, active: false });
  try {
    await chrome.tabs.update(tab.id, { muted: true }).catch(() => {});
    let r = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt > 1) {
        setRowStatus(row, "스크립트를 찾지 못해 페이지를 새로고침해 다시 찾는 중…");
        await chrome.tabs.reload(tab.id);
      }
      await waitTabComplete(tab.id);
      setRowStatus(row, "'…더보기' → '스크립트 표시' 여는 중…");
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: grabTranscriptInPage });
      r = res && res.result;
      if (r && r.lines.length) break;
    }
    if (!r) throw new Error("유튜브 화면을 읽지 못했습니다");
    if (r.title) {
      result.title = r.title;
      setRowTitle(row, r.title);
    }
    for (const l of r.lines) {
      const t = parseClock(l.time);
      if (t !== null && l.text) result.lines.push({ t, text: l.text });
    }
    if (!result.lines.length) throw new NoTranscriptError("이 영상에는 유튜브 스크립트가 없습니다");
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// 화면
// ---------------------------------------------------------------------------

let running = false;
let abortDrain = null;
const results = []; // { title, videoId, url, lines, fixed }
let runUrls = []; // 이번에 수집한 URL (전체 파일 순서)
let selected = -1;

function showResult(i) {
  selected = i;
  const r = results[i];
  document.querySelectorAll("#progress tbody tr").forEach((tr, j) => tr.classList.toggle("selected", j === i));
  const out = $("#output");
  const atBottom = out.scrollTop + out.clientHeight >= out.scrollHeight - 20;
  out.value = r ? scriptText(r.fixed || r.lines) : "";
  if (atBottom) out.scrollTop = out.scrollHeight;
  const fixNote = r && r.fixed ? ` · 교정 ${r.fixes}곳` : "";
  $("#outputTitle").textContent = r ? `— ${r.title || r.videoId} (${r.lines.length}줄${fixNote})` : "";
  $("#copy").disabled = $("#save").disabled = !(r && r.lines.length);
}

// 띄어쓰기·자주 틀리는 맞춤법을 기본 규칙으로 고친 교정본을 만든다 (correct.js)
function correctResult(r) {
  r.fixes = 0;
  r.fixed = r.lines.map((l) => {
    const c = ScriptCorrect.correctText(l.text);
    r.fixes += c.fixes;
    return { t: l.t, text: c.text };
  });
}

// 교정본(날짜_제목.txt)과 원본(날짜_제목_원본.txt)을 함께 저장
function saveResult(i) {
  const r = results[i];
  if (!r || !r.lines.length) return;
  const base = `${today()}_${safeFileName(r.title) || r.videoId}`;
  downloadText(scriptText(r.fixed || r.lines), `${base}.txt`);
  // 바로 이어서 내려받으면 크롬이 앞의 다운로드를 취소할 수 있어 잠시 뒤에 원본을 받는다
  const original = scriptText(r.lines);
  if (r.fixed) setTimeout(() => downloadText(original, `${base}_원본.txt`), 800);
}

function rowButton(td, label, onClick, cls = "") {
  const b = document.createElement("button");
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener("click", onClick);
  td.appendChild(b);
  return b;
}

async function copyText(text, btn) {
  await navigator.clipboard.writeText(text);
  const old = btn.textContent;
  btn.textContent = "복사됨 ✔";
  setTimeout(() => (btn.textContent = old), 1500);
}

function addRowActions(row, i) {
  const td = row.querySelector(".actions");
  td.innerHTML = "";
  rowButton(td, "보기", () => showResult(i));
  const copy = rowButton(td, "복사", () => {
    const r = results[i];
    if (r && r.lines.length) copyText(scriptText(r.fixed || r.lines), copy);
  });
  rowButton(td, ".txt", () => saveResult(i));
}

// 수집한 모든 스크립트를 영상별로 구분해 한 파일로 (교정본)
function combinedText() {
  const line = "=".repeat(60);
  const parts = [];
  runUrls.forEach((url, i) => {
    const r = results[i];
    const id = r ? r.videoId : parseYoutubeId(url);
    const head = `[${i + 1}/${runUrls.length}] ${(r && r.title) || "(제목 없음)"}`;
    const link = id ? `https://www.youtube.com/watch?v=${id}` : url;
    const body = r && r.lines.length ? scriptText(r.fixed || r.lines) : "(스크립트를 가져오지 못했습니다)";
    parts.push(`${line}\n${head}\n${link}\n${line}\n${body}`);
  });
  return parts.join("\n\n\n");
}

function updateSaveAll() {
  $("#saveAll").disabled = !results.some((r) => r && r.lines.length);
}

async function transcribeVideo(url, row, index, opts) {
  const videoId = parseYoutubeId(url);
  if (!videoId) throw new Error("유튜브 영상 주소가 아닙니다");
  const result = { videoId, url, title: "", lines: [] };
  results[index] = result;
  addRowActions(row, index);

  if (opts.mode === "transcript") {
    try {
      await readYoutubeTranscript(videoId, row, result);
      return result;
    } catch (e) {
      if (!(e instanceof NoTranscriptError) || opts.fallback === "ask") throw e;
      result.lines = [];
      opts = { ...opts, mode: opts.fallback, speed: DEFAULT_SPEED[opts.fallback] };
      setRowStatus(row, `유튜브 스크립트가 없어 ${MODE_LABEL[opts.mode]}으로 수집합니다…`);
    }
  }

  if (opts.mode === "screen") {
    await readScreenVideo(videoId, row, index, opts, result);
    return result;
  }

  await ensureModel(opts.model, (t) => setRowStatus(row, t));

  let duration = 0;
  let recording = true;
  let muted = opts.mute;
  const job = new VideoJob(opts.speed, () => {
    if (selected === index) showResult(index);
    status();
  });
  result.lines = job.lines;
  function status() {
    const waiting = job.windows.length + (job.pump ? 1 : 0);
    const rec = recording ? `영상 듣는 중 ${fmtTime(job.lastT)} / ${fmtTime(duration)}` : "받아쓰기 마무리 중";
    setRowStatus(row, `${rec} · ${job.lines.length}줄${waiting ? ` · 받아쓰기 대기 ${waiting}구간` : ""}`);
  }

  setRowStatus(row, "유튜브 탭 여는 중…");
  try {
    await runInYoutubeTab({
      videoId,
      files: ["script-capture.js"],
      portName: "script",
      start: { speed: opts.speed },
      mute: muted,
      onMessage(m, port, tabId) {
        if (m.type === "info") {
          result.title = m.title;
          duration = m.duration;
          setRowTitle(row, m.title);
          if (selected === index) showResult(index);
        } else if (m.type === "status") {
          setRowStatus(row, m.text);
        } else if (m.type === "needplay") {
          setRowStatus(row, "유튜브 탭에서 재생 버튼(▶)을 한 번 눌러 주세요", "err");
        } else if (m.type === "playing") {
          status();
        } else if (m.type === "audio") {
          if (job.error) throw job.error;
          if (m.epoch !== job.epoch) return false;
          job.push(m.t, decodePcm(m.data));
          // 탭 음소거 때문에 소리가 하나도 안 잡히면 음소거를 풀고 처음부터 다시
          if (muted && job.received >= MUTE_CHECK_SEC * SR && job.peak === 0) {
            muted = false;
            job.reset();
            job.epoch++;
            chrome.tabs.update(tabId, { muted: false });
            port.postMessage({ type: "restart", epoch: job.epoch });
          }
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
  }

  recording = false;
  job.flush();
  status();
  await new Promise((resolve, reject) => {
    abortDrain = () => {
      job.stopped = true;
      reject(new Error("중지됨"));
    };
    job.drain().then(resolve, reject);
  });
  abortDrain = null;
  return result;
}

function currentOpts() {
  const mode = $("#mode").value;
  return {
    mode,
    fallback: $("#fallback").value,
    model: $("#model").value,
    speed: Number($("#speed").value) || DEFAULT_SPEED[mode] || 1,
    region: Number($("#region").value),
    mute: $("#mute").checked,
  };
}

function setRunning(on) {
  running = on;
  $("#start").disabled = on;
  $("#stop").disabled = !on;
  document.querySelectorAll("button.retry").forEach((b) => (b.disabled = on));
}

// 실패한 줄에는 [재시도], 스크립트가 없는 줄에는 [재시도] [화면 자막으로] [음성으로]
function offerRetry(row, i, url, opts, missing) {
  const td = row.querySelector(".actions");
  td.innerHTML = "";
  rowButton(td, "재시도", () => retryWith(i, url, row, opts), "retry");
  if (!missing) return;
  for (const [mode, label] of [["screen", "화면 자막으로"], ["speech", "음성으로"]]) {
    const b = rowButton(td, label, () => retryWith(i, url, row, { ...opts, mode, speed: DEFAULT_SPEED[mode] }), "retry");
    b.title = `${MODE_LABEL[mode]}으로 이 영상의 스크립트를 만듭니다`;
  }
}

// 영상 하나 → 'ok' | 'missing'(스크립트 없음) | 'fail'  (파일은 자동으로 받지 않음)
async function runOne(i, url, row, opts) {
  showResult(i);
  try {
    const r = await transcribeVideo(url, row, i, opts);
    correctResult(r);
    setRowStatus(row, `완료 · ${r.lines.length}줄 · 교정 ${r.fixes}곳`, "ok");
    addRowActions(row, i);
    showResult(i);
    return "ok";
  } catch (e) {
    if (e instanceof NoTranscriptError) {
      setRowStatus(row, "유튜브 스크립트를 찾지 못했습니다 → [재시도] 또는 다른 방식을 고르세요", "err");
      offerRetry(row, i, url, opts, true);
      return "missing";
    }
    const n = results[i] ? results[i].lines.length : 0;
    setRowStatus(row, `${e.message}${n ? ` (그때까지 ${n}줄)` : ""}`, "err");
    if (results[i]) showResult(i);
    if (parseYoutubeId(url)) offerRetry(row, i, url, opts, false);
    return "fail";
  } finally {
    updateSaveAll();
  }
}

async function retryWith(i, url, row, opts) {
  if (running) return;
  setRunning(true);
  setSummary(`${i + 1}번 영상 다시 수집하는 중…`);
  const r = await runOne(i, url, row, { ...currentOpts(), ...opts });
  setSummary(
    r === "ok" ? `${i + 1}번 영상 스크립트를 수집했습니다. '전체 스크립트 한 파일로 받기'로 내려받으세요.` : "이번에도 수집하지 못했습니다. 줄의 상태를 확인하세요.",
    r === "ok" ? "ok" : "err",
  );
  setRunning(false);
}

async function start() {
  const urls = readUrls();
  if (!urls.length) return setSummary("유튜브 영상 URL을 입력하세요.", "err");
  const opts = currentOpts();
  setRunning(true);
  $("#progress tbody").innerHTML = "";
  results.length = 0;
  runUrls = urls;
  showResult(-1);
  updateSaveAll();
  const count = { ok: 0, missing: 0, fail: 0 };

  for (let i = 0; i < urls.length && running; i++) {
    const row = addProgressRow(i, urls[i]);
    setSummary(`${i + 1} / ${urls.length}번째 영상 스크립트 수집 중…`);
    count[await runOne(i, urls[i], row, opts)]++;
  }

  if (running) {
    const failed = count.missing + count.fail;
    setSummary(
      `${count.ok} / ${urls.length}개 영상 스크립트를 수집했습니다. '전체 스크립트 한 파일로 받기'로 내려받으세요.` +
        (failed ? ` 수집하지 못한 ${failed}개는 줄 오른쪽 [재시도] 버튼을 누르세요.` : ""),
      failed ? "" : "ok",
    );
    setRunning(false);
    alert(
      `스크립트 수집을 마쳤습니다.\n\n성공 ${count.ok}개` +
        (count.missing ? ` · 스크립트 없음 ${count.missing}개` : "") +
        (count.fail ? ` · 실패 ${count.fail}개` : "") +
        `\n\n'전체 스크립트 한 파일로 받기' 버튼으로 모든 스크립트를 한 파일에 받을 수 있습니다.`,
    );
  } else {
    setSummary("중지했습니다. 그때까지 받아쓴 내용은 ‘보기’로 확인할 수 있습니다.");
    setRunning(false);
  }
}

const SPEEDS = {
  speech: [
    ["1", "1배 (가장 정확)"],
    ["1.5", "1.5배"],
    ["2", "2배 (빠르지만 덜 정확)"],
  ],
  screen: [
    ["1", "1배 (짧은 자막도 놓치지 않음)"],
    ["2", "2배"],
    ["3", "3배 (권장)"],
    ["4", "4배 (가장 빠름)"],
  ],
};

function onModeChange() {
  const mode = $("#mode").value;
  const speed = $("#speed");
  speed.innerHTML = "";
  for (const [v, label] of SPEEDS[mode] || []) speed.add(new Option(label, v));
  if (SPEEDS[mode]) speed.value = String(DEFAULT_SPEED[mode]);
  document.querySelectorAll("[data-mode]").forEach((el) => (el.hidden = !el.dataset.mode.split(" ").includes(mode)));
  try {
    localStorage.setItem("scriptMode3", mode);
  } catch {}
}

async function init() {
  menu("script.html");
  gpu = await detectGpu();
  const sel = $("#model");
  for (const [key, m] of Object.entries(MODELS)) {
    const opt = new Option(m.label, key);
    if (m.gpuOnly && !gpu) {
      opt.disabled = true;
      opt.textContent += " - 그래픽 가속 필요";
    }
    sel.add(opt);
  }
  sel.value = gpu ? "turbo" : "small";
  $("#gpu").textContent = gpu
    ? "✔ 그래픽 가속(WebGPU)을 사용합니다."
    : "그래픽 가속(WebGPU)을 쓸 수 없어 CPU 로 처리합니다. 받아쓰기가 영상보다 느릴 수 있습니다.";
  $("#gpu").className = `hint ${gpu ? "ok" : ""}`;

  try {
    $("#mode").value = localStorage.getItem("scriptMode3") || "transcript"; // 기본: 유튜브 스크립트 가져오기
  } catch {}
  $("#mode").addEventListener("change", onModeChange);
  onModeChange();

  $("#start").addEventListener("click", start);
  $("#stop").addEventListener("click", () => {
    running = false;
    $("#stop").disabled = true;
    if (runInYoutubeTab.abort) runInYoutubeTab.abort();
    if (abortDrain) abortDrain();
  });
  $("#copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("#output").value);
    $("#copy").textContent = "복사됨 ✔";
    setTimeout(() => ($("#copy").textContent = "복사"), 1500);
  });
  $("#save").addEventListener("click", () => saveResult(selected));
  $("#saveAll").addEventListener("click", () =>
    downloadText(combinedText(), `${today()}_유튜브스크립트_${results.filter((r) => r && r.lines.length).length}개.txt`),
  );
}

init();
