// AI 성향 재분석: Google Gemini(무료 한도) 먼저 → 한도 초과·오류면 Claude API 로 이어서
import Anthropic from "@anthropic-ai/sdk";
import { getState, setState } from "./db.js";

const LABELS = ["pos", "neu", "neg", "abuse"];

const SYSTEM = `당신은 현대자동차 온라인 여론 모니터링 담당자입니다. 각 게시물이 현대자동차·제네시스(브랜드, 차량, 서비스, 회사)에 대해 어떤 성향인지 판정하세요.
- pos(긍정): 칭찬, 만족, 추천, 호평, 좋은 소식
- neu(중립): 단순 정보·질문·뉴스 전달, 판단 없음, 현대차와 무관
- neg(부정): 결함·고장·사고·화재·리콜·서비스 불만 등 구체적인 문제 제기나 비판
- abuse(단순비난): 구체적 근거 없이 욕설·조롱·비아냥만 있는 글 (예: 흉기차, 현기차 등)
reason 에는 판단 근거를 한국어 30자 이내로 쓰세요.`;

const promptFor = (posts) =>
  `${SYSTEM}\n\n게시물 목록(JSON):\n${JSON.stringify(posts.map((p) => ({ id: p.id, channel: p.channel, title: p.title, text: (p.desc || "").slice(0, 300) })))}`;

const ITEM_SCHEMA = {
  type: "object",
  properties: { id: { type: "string" }, sentiment: { type: "string", enum: LABELS }, reason: { type: "string" } },
  required: ["id", "sentiment", "reason"],
  additionalProperties: false,
};

async function gemini(posts, key, model) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: promptFor(posts) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: { type: "OBJECT", properties: { id: { type: "STRING" }, sentiment: { type: "STRING", enum: LABELS }, reason: { type: "STRING" } }, required: ["id", "sentiment", "reason"] },
        },
      },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`Gemini ${r.status}: ${j.error?.message || ""}`.slice(0, 200));
    e.quota = r.status === 429 || /quota|exhausted/i.test(j.error?.message || "");
    throw e;
  }
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "[]";
  return JSON.parse(text);
}

// 서버 측 거절 대비 자동 대체 모델(fallbacks)을 지원하는 모델
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-fable-5-2"]);

async function claude(posts, key, model, effort) {
  const client = new Anthropic({ apiKey: key });
  const params = {
    model,
    max_tokens: 8000,
    output_config: {
      effort,
      format: { type: "json_schema", schema: { type: "object", properties: { results: { type: "array", items: ITEM_SCHEMA } }, required: ["results"], additionalProperties: false } },
    },
    messages: [{ role: "user", content: promptFor(posts) }],
  };
  const res = FALLBACK_MODELS.has(model)
    ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
    : await client.messages.create(params);
  if (res.stop_reason === "refusal") throw new Error("Claude 가 이 묶음 분석을 거절했습니다");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text).results || [];
}

// posts: [{id, channel, title, desc}] → [{id, sentiment, reason, by}]
export async function analyzePosts(posts, settings, secrets, log = [], { geminiOnly = false } = {}) {
  const ai = settings.ai || {};
  const st = await getState("ai");
  const out = [];
  for (let i = 0; i < posts.length; i += 25) {
    const chunk = posts.slice(i, i + 25);
    let res = null;
    let by = "";
    const geminiOk = secrets.geminiKey && !(st.geminiBlockedUntil > Date.now());
    if (geminiOk) {
      try {
        res = await gemini(chunk, secrets.geminiKey, (!ai.geminiModel || /^gemini-(1\.|2\.0|2\.5)/.test(ai.geminiModel) ? "gemini-flash-latest" : ai.geminiModel));
        by = "gemini";
      } catch (e) {
        log.push(e.message);
        // 한도 초과면 30분 동안 Gemini 를 건너뛰고 Claude 로
        if (e.quota) { st.geminiBlockedUntil = Date.now() + 30 * 60e3; await setState("ai", st); }
      }
    }
    if (!res && secrets.claudeKey && !geminiOnly) {
      try {
        res = await claude(chunk, secrets.claudeKey, ai.claudeModel || "claude-opus-5-5", ai.claudeEffort || "low");
        by = "claude";
      } catch (e) {
        log.push(`Claude: ${e.message}`);
      }
    }
    if (!res) throw new Error(`AI 분석 실패: ${log.slice(-2).join(" / ") || "Gemini·Claude API 키를 설정에서 넣어 주세요"}`);
    const ids = new Set(chunk.map((p) => p.id));
    for (const r of res) if (ids.has(r.id) && LABELS.includes(r.sentiment)) out.push({ ...r, reason: String(r.reason || "").slice(0, 80), by });
  }
  return out;
}

// 새 글 자동 AI 성향 분석 (설정의 채널만 · 비용이 들지 않도록 Gemini 무료 한도로만)
export async function autoAnalyze(created, settings, secrets, log) {
  const chans = new Set(settings.ai?.autoChannels || ["ppomppu"]);
  const targets = created.filter((p) => chans.has(p.channel) && p.sentimentBy === "rule").slice(0, 50);
  if (!targets.length || !secrets.geminiKey) return;
  let res;
  try {
    res = await analyzePosts(targets, settings, secrets, [], { geminiOnly: true });
  } catch (e) {
    log.push(`자동 AI 분석 건너뜀: ${String(e.message).slice(0, 80)}`);
    return;
  }
  const { applySentiment } = await import("./sentimentApply.js");
  // 게시물 · 통계 · 실시간 피드를 함께 (created 객체도 함께 바뀌어 알림에 새 성향이 쓰임)
  await applySentiment(res, new Map(targets.map((p) => [p.id, p])));
  log.push(`자동 AI 성향 분석: ${res.length}건`);
}
