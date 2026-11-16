// 현대차 관련 여부 · 부정 프레임 판단(단어) · 한 줄 요약(설명에서 추리기) · Claude AI 요약·논조 판단

function wordsRe(list) {
  const ws = splitList(list).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*"));
  return ws.length ? new RegExp(`(${ws.join("|")})`, "gi") : null;
}

function hits(re, text) {
  if (!re) return [];
  return [...new Set((String(text || "").match(re) || []).map((w) => w.replace(/\s+/g, " ").trim()))];
}

// 설명에서 광고·링크·해시태그·타임라인 줄을 빼고 내용 문장만
function descLines(desc) {
  return String(desc || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length >= 12 &&
        !/https?:\/\/|www\.|@\w|^#|#\S+\s*#\S+|문의|구독|좋아요|알림|출처|저작권|무단|제보|협찬|광고|유료\s*광고|후원|멤버십|채널\s*가입|instagram|facebook|kakao|카카오|오픈채팅|강의|할인|쿠폰|촬영일|촬영본|^\d{1,2}:\d{2}|^\[?\d{1,2}:\d{2}|^[-=*※▶►■●◆]+\s*$|©/i.test(l),
    );
}

// 외국 콘텐츠: 제목에 한글이 없거나, 제목·채널 이름에 키릴(러시아어)·아랍·태국·힌디·히브리·그리스·일본 가나 글자가 있으면
// (예: 'AK Auto Repair Автоэлектрик Диагност') — 수집하지 않음
const FOREIGN_SCRIPT = /[\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0750-\u077F\u0E00-\u0E7F\u0900-\u097F\u0590-\u05FF\u0370-\u03FF\u3040-\u30FF]/;
function isForeign(v) {
  const title = String(v.title || "");
  if (!/[가-힣]/.test(title)) return true;
  return FOREIGN_SCRIPT.test(`${title} ${v.channelName || ""}`);
}

// 규칙으로 쓰는 한 줄 요약: 설명의 첫 내용 문장 (없으면 제목)
function ruleSummary(v) {
  const lines = descLines(v.desc);
  let s = lines.find((l) => /현대|정의선|자동차|차/.test(l)) || lines[0] || "";
  s = s.replace(/^[\[(【][^\])】]{0,20}[\])】]\s*/, "").replace(/\s+/g, " ").trim();
  if (!s) s = String(v.title || "").replace(/#\S+/g, "").replace(/\s+/g, " ").trim();
  const sent = s.match(/^.{15,}?[.!?。](?=\s|$)/);
  if (sent) s = sent[0];
  return s.length > 90 ? `${s.slice(0, 88)}..` : s;
}

// 단어로 판단: { topic, negHits, score, frame }
function classify(v, settings) {
  const topicRe = wordsRe(settings.topicWords);
  const negRe = wordsRe(settings.negWords);
  const posRe = wordsRe(settings.posWords);
  const head = String(v.desc || "").slice(0, 400);
  const topic = hits(topicRe, v.title).length > 0 || hits(topicRe, `${v.snippet || ""} ${head}`).length > 0;
  const tNeg = hits(negRe, v.title);
  const dNeg = hits(negRe, head).filter((w) => !tNeg.includes(w));
  const pos = hits(posRe, `${v.title} ${head}`);
  const score = tNeg.length * 2 + Math.min(dNeg.length, 3) - (pos.length ? 1 : 0);
  return { topic, negHits: [...tNeg, ...dNeg], score, frame: score >= 2 ? "부정" : score >= 1 ? "주의" : "중립" };
}

// 포함 여부 (DB 에서 직접 바꾼 것은 그대로) — AI 판단이 있으면 AI 우선
function decideInclude(v) {
  if (v.manual != null) return v.manual;
  if (v.ai && v.ai.relevant != null) return v.ai.relevant && v.ai.tone === "부정";
  return v.topic && v.frame === "부정";
}

function toneOf(v) {
  return v.ai?.tone || v.frame || "";
}

// ---------------------------------------------------------------------------
// Claude AI: 한 줄 요약 · 현대차 위기론 관련 여부 · 논조 · 프레임 유형
// ---------------------------------------------------------------------------

const AI_FRAMES = ["판매·내수 부진", "가격·옵션 논란", "중국차·테슬라 경쟁", "주가·실적", "관세·통상", "전기차·미래차 전략", "품질·결함", "노사·파업", "경영·지배구조", "기타"];
const AI_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          summary: { type: "string" },
          relevant: { type: "boolean" },
          tone: { type: "string", enum: ["부정", "중립", "긍정"] },
          frame: { type: "string", enum: AI_FRAMES },
        },
        required: ["id", "summary", "relevant", "tone", "frame"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const AI_SYSTEM = `당신은 자동차 회사 홍보팀의 온라인 여론 모니터링 담당자입니다.
유튜브 영상의 제목·채널·설명을 보고 영상마다 다음을 판단합니다.
- summary: 영상이 어떤 내용인지 보고서용 한 줄 요약 (한국어, 40~70자, '~라는 내용', '~주장' 같은 명사형 종결. 과장·감탄 없이 사실 위주).
- relevant: '현대차(현대자동차·현대차그룹) 위기론'과 관련된 영상인지. 현대차의 판매 부진·가격 논란·경쟁 열세·주가 하락·관세·전략 실패·품질·노사 등 현대차가 위기라는 흐름을 다루면 true.
  현대차가 잠깐 언급만 되거나(다른 회사·종목 이야기), 신차 단순 소개·시승기, 주식 종목 추천 목록 중 하나일 뿐이면 false.
- tone: 현대차에 대한 논조. 위기·실패·비판·조롱 프레임이면 '부정', 사실 전달·양측 균형이면 '중립', 극복·호평·기회 강조면 '긍정'.
  제목·썸네일 문구처럼 자극적인 '위기' 프레임을 쓰면 본문이 균형적이어도 '부정'으로 봅니다.
- frame: 가장 가까운 위기론 유형 하나.
입력에 있는 영상 수만큼, id 를 그대로 돌려주세요.`;

async function aiBatch(key, model, batch) {
  const input = batch.map((v) => ({
    id: v.id,
    채널: v.channelName,
    제목: v.title,
    게시일: v.published ? new Date(v.published).toISOString().slice(0, 10) : "",
    설명: String(v.desc || v.snippet || "").slice(0, 1500),
  }));
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system: AI_SYSTEM,
      output_config: { format: { type: "json_schema", schema: AI_SCHEMA } },
      messages: [{ role: "user", content: `아래 유튜브 영상 ${batch.length}개를 판단해 items ${batch.length}개로 돌려주세요.\n\n${JSON.stringify(input)}` }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    const e = new Error(res.status === 401 ? "API 키가 맞지 않습니다" : res.status === 429 ? "요청이 많아 잠시 막혔습니다 (잠시 뒤 다시)" : msg);
    e.status = res.status;
    throw e;
  }
  if (body.stop_reason === "refusal") throw new Error("Claude 가 이 묶음의 판단을 거절했습니다");
  const text = (body.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const parsed = JSON.parse(text);
  const usage = body.usage || {};
  return { items: parsed.items || [], input: usage.input_tokens || 0, output: usage.output_tokens || 0 };
}

function aiWon(input, output, model) {
  const [i, o] = AI_PRICE[model] || AI_PRICE["claude-sonnet-5-5"];
  return ((input * i + output * o) / 1e6) * WON_PER_USD;
}
