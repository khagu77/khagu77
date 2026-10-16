// AI 교정 (Claude API) - 스크립트의 띄어쓰기·맞춤법·오탈자·잘못 받아쓴 차량명 등을 문맥에 맞게 고친다.
// 공식 Anthropic SDK(lib/anthropic-sdk.min.js, 전역 Anthropic)를 쓴다. API 키는 이 PC 크롬에만 저장된다.
// 결과는 입력과 같은 줄 수·같은 순서로 받아(구조화된 출력 JSON) 시간(00:00)과 줄 구분은 그대로 둔다.

const AI_MODELS = [
  ["claude-opus-5-5", "Claude Opus 5.5 (가장 정확 · 기본)"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 (더 빠름 · 약 절반 가격)"],
  ["claude-haiku-5-5", "Claude Haiku 5.5 (가장 저렴)"],
];
const AI_CHUNK = 120; // 한 번에 보내는 줄 수 (긴 영상은 나눠서)
const AI_PARALLEL = 4; // 동시에 보내는 요청 수 (모든 영상·묶음 합쳐서)

// 동시에 보내는 요청 수를 AI_PARALLEL 개로 묶는 줄 세우기
const aiSlots = { busy: 0, waiting: [] };
async function withAiSlot(fn) {
  if (aiSlots.busy >= AI_PARALLEL) await new Promise((resolve) => aiSlots.waiting.push(resolve));
  aiSlots.busy++;
  try {
    return await fn();
  } finally {
    aiSlots.busy--;
    const next = aiSlots.waiting.shift();
    if (next) next();
  }
}

const AI_SYSTEM = `당신은 한국어 유튜브 스크립트(자동 자막)를 다듬는 교정자입니다. 영상은 주로 자동차 리뷰·시승기·자동차 소식입니다.
각 줄은 영상의 한 구간에서 들린 말을 받아쓴 것입니다. 각 줄을 아래 기준으로 고쳐서, 같은 순서·같은 개수로 돌려주세요.
- 띄어쓰기, 맞춤법, 오탈자를 바르게 고칩니다.
- 음성 인식이 잘못 받아쓴 말을 앞뒤 문맥에 맞게 고칩니다. 특히 차량 모델명·브랜드·트림·부품·기술 용어를 정확한 표기로 씁니다(예: 아이오닉 5, 그랑 콜레오스, 팰리세이드, 쏘렌토 하이브리드, BMW 340i, FSD).
- 말한 내용과 말투(구어체, 감탄사, 반복)는 그대로 둡니다. 요약하거나 문장을 새로 쓰거나 내용을 더하거나 빼지 않습니다.
- 무엇인지 확실하지 않은 말은 원래대로 둡니다.
- "챕터 N: 제목" 같은 줄은 제목의 표기만 다듬습니다.
- 줄을 합치거나 나누지 않습니다. 돌려주는 lines 의 개수는 받은 lines 의 개수와 반드시 같아야 합니다.`;

const AI_SCHEMA = {
  type: "object",
  properties: { lines: { type: "array", items: { type: "string" } } },
  required: ["lines"],
  additionalProperties: false,
};

function aiErrorMessage(e) {
  if (typeof Anthropic === "undefined") return "AI 교정 도구를 불러오지 못했습니다";
  if (e instanceof Anthropic.AuthenticationError) return "API 키가 올바르지 않습니다";
  if (e instanceof Anthropic.PermissionDeniedError) return "이 API 키로는 이 모델을 쓸 수 없습니다";
  if (e instanceof Anthropic.RateLimitError) return "요청이 너무 많습니다(잠시 후 다시 시도)";
  if (e instanceof Anthropic.BadRequestError) return `요청 오류: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return "Claude API 에 연결하지 못했습니다(인터넷 확인)";
  if (e instanceof Anthropic.APIError) return `Claude API 오류: ${e.message}`;
  return e && e.message ? e.message : String(e);
}

async function aiCorrectChunk(client, model, texts) {
  const params = {
    model,
    max_tokens: 64000,
    system: AI_SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: AI_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `아래 lines 의 각 줄을 교정해서 같은 개수(${texts.length}줄)의 lines 로 돌려주세요.\n\n${JSON.stringify({ lines: texts })}`,
      },
    ],
  };
  // 안전 분류기가 거절하면 서버가 알아서 다른 모델로 다시 돌린다 (Haiku 는 지원하지 않아 그대로)
  const stream = model === "claude-haiku-5-5"
    ? client.messages.stream(params)
    : client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("Claude 가 이 내용의 교정을 거절했습니다");
  if (msg.stop_reason === "max_tokens") throw new Error("교정 결과가 너무 길어 잘렸습니다");
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.lines) || parsed.lines.length !== texts.length) {
    throw new Error(`교정 결과의 줄 수가 맞지 않습니다(${parsed && parsed.lines ? parsed.lines.length : 0}/${texts.length})`);
  }
  return parsed.lines.map((t, k) => (typeof t === "string" && t.trim() ? t.replace(/\s+/g, " ").trim() : texts[k]));
}

// texts(줄 글자 배열) → 교정된 같은 길이의 배열. 묶음(120줄)들은 동시에 보내고(최대 AI_PARALLEL),
// 실패한 묶음은 한 번 더 시도하고, 그래도 안 되면 원래 줄을 둔다.
async function aiCorrectLines(texts, { apiKey, model, onProgress }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 4 });
  const starts = [];
  for (let i = 0; i < texts.length; i += AI_CHUNK) starts.push(i);
  let done = 0;
  let failed = 0;
  let lastError = null;
  let fatal = null;
  if (onProgress) onProgress(0, texts.length);
  const parts = await Promise.all(
    starts.map((i) =>
      withAiSlot(async () => {
        const chunk = texts.slice(i, i + AI_CHUNK);
        let fixed = null;
        for (let attempt = 1; attempt <= 2 && !fixed && !fatal; attempt++) {
          try {
            fixed = await aiCorrectChunk(client, model, chunk);
          } catch (e) {
            lastError = e;
            // 키·권한 문제는 다시 해도 같으므로 바로 멈춘다
            if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) fatal = e;
          }
        }
        if (!fixed) {
          failed += chunk.length;
          fixed = chunk;
        }
        done += chunk.length;
        if (onProgress) onProgress(done, texts.length);
        return fixed;
      }),
    ),
  );
  if (fatal) throw fatal;
  if (failed === texts.length) throw lastError || new Error("AI 교정에 실패했습니다");
  return { lines: parts.flat(), failed, lastError };
}

// 대략적인 요금 추정 (원). 한국어는 글자 1개가 토큰 약 1개 정도로 잡는다. 1달러 = 1,400원으로 계산.
const AI_PRICE = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5] };
function aiCostEstimateWon(chars, model) {
  const [inP, outP] = AI_PRICE[model] || AI_PRICE["claude-opus-5-5"];
  const tokens = chars * 1.0;
  const usd = (tokens * 1.15 * inP + tokens * 1.2 * outP) / 1e6; // 입력(지시문 포함)·출력(JSON 포함)
  return Math.round((usd * 1400) / 10) * 10;
}
