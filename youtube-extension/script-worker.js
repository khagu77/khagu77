// 스크립트 추출 - 음성인식(Whisper) 작업자.
// 모델 파일은 처음 한 번 huggingface.co 에서 내려받아 브라우저 저장소에 보관한다.
import { pipeline, env } from "./lib/transformers.min.js";

env.allowLocalModels = false;
// 실행 파일(wasm)은 인터넷이 아닌 확장 안의 lib 폴더에서 읽는다.
env.backends.onnx.wasm.wasmPaths = new URL("./lib/", self.location.href).href;

let asr = null;

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      asr = await pipeline("automatic-speech-recognition", data.model, {
        device: data.device,
        dtype: data.dtype,
        progress_callback: (p) => {
          if (p.status === "progress") self.postMessage({ type: "progress", file: p.file, loaded: p.loaded, total: p.total });
        },
      });
      self.postMessage({ type: "ready" });
    } else if (data.type === "run") {
      const out = await asr(data.audio, { language: "korean", task: "transcribe", return_timestamps: true });
      const chunks = out.chunks && out.chunks.length ? out.chunks : [{ timestamp: [0, null], text: out.text }];
      self.postMessage({ type: "result", id: data.id, chunks: chunks.map((c) => ({ start: c.timestamp[0] || 0, text: c.text })) });
    }
  } catch (e) {
    self.postMessage({ type: "error", id: data.id, message: String((e && e.message) || e) });
  }
};
