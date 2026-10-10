// 스크립트 추출 - 화면 (common.js 다음에 넣는다)
// 영상을 유튜브 탭에서 재생하고(script-capture.js), 받은 소리를 30초 안쪽 구간으로 잘라
// 음성인식 작업자(script-worker.js)로 받아쓴 뒤 "00:00 스크립트 내용" 줄로 모은다.

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
// 화면
// ---------------------------------------------------------------------------

let running = false;
let abortDrain = null;
const results = []; // { title, videoId, lines }
let selected = -1;

function showResult(i) {
  selected = i;
  const r = results[i];
  document.querySelectorAll("#progress tbody tr").forEach((tr, j) => tr.classList.toggle("selected", j === i));
  const out = $("#output");
  const atBottom = out.scrollTop + out.clientHeight >= out.scrollHeight - 20;
  out.value = r ? scriptText(r.lines) : "";
  if (atBottom) out.scrollTop = out.scrollHeight;
  $("#outputTitle").textContent = r ? `— ${r.title || r.videoId} (${r.lines.length}줄)` : "";
  $("#copy").disabled = $("#save").disabled = !(r && r.lines.length);
}

function saveResult(i) {
  const r = results[i];
  if (r && r.lines.length) downloadText(scriptText(r.lines), `${today()}_${safeFileName(r.title) || r.videoId}.txt`);
}

function addRowActions(row, i) {
  const td = row.querySelector(".actions");
  td.innerHTML = "";
  const view = document.createElement("button");
  view.textContent = "보기";
  view.addEventListener("click", () => showResult(i));
  const save = document.createElement("button");
  save.textContent = ".txt";
  save.addEventListener("click", () => saveResult(i));
  td.append(view, save);
}

async function transcribeVideo(url, row, index, opts) {
  const videoId = parseYoutubeId(url);
  if (!videoId) throw new Error("유튜브 영상 주소가 아닙니다");
  const result = { videoId, title: "", lines: [] };
  results[index] = result;
  addRowActions(row, index);

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

async function start() {
  const urls = readUrls();
  if (!urls.length) return setSummary("유튜브 영상 URL을 입력하세요.", "err");
  const opts = { model: $("#model").value, speed: Number($("#speed").value), mute: $("#mute").checked };
  running = true;
  $("#start").disabled = true;
  $("#stop").disabled = false;
  $("#progress tbody").innerHTML = "";
  results.length = 0;
  showResult(-1);
  let ok = 0;

  for (let i = 0; i < urls.length && running; i++) {
    const row = addProgressRow(i, urls[i]);
    setSummary(`${i + 1} / ${urls.length}번째 영상 스크립트 만드는 중…`);
    showResult(i);
    try {
      const r = await transcribeVideo(urls[i], row, i, opts);
      setRowStatus(row, `완료 · ${r.lines.length}줄`, "ok");
      showResult(i);
      saveResult(i);
      ok++;
    } catch (e) {
      const n = results[i] ? results[i].lines.length : 0;
      setRowStatus(row, `${e.message}${n ? ` (그때까지 ${n}줄)` : ""}`, "err");
      if (results[i]) showResult(i);
    }
  }

  setSummary(
    running
      ? `${ok} / ${urls.length}개 영상 스크립트를 다운로드 폴더에 .txt 로 저장했습니다.`
      : "중지했습니다. 그때까지 받아쓴 내용은 ‘보기’로 확인할 수 있습니다.",
    running ? "ok" : "",
  );
  running = false;
  $("#start").disabled = false;
  $("#stop").disabled = true;
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
}

init();
