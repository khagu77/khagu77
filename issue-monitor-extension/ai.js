// Claude API 로 1) 제목 선별 2) 본문을 읽고 부정 이슈 판정·구분·차종·요약을 한다.

const TRIAGE_BATCH = 150; // 제목 선별 한 번에 보낼 글 수
const CLASSIFY_BATCH = 6; // 본문 판정 한 번에 보낼 글 수
const BODY_CHARS = 3000; // 본문은 앞부분만 보낸다 (비용 절약)

const ISSUE_DEFINITION = `부정 이슈는 다음 3가지다.
1) 품질: 차량 고장·불량·결함, 소음·진동, 누수, 경고등 점등, 소프트웨어·인포테인먼트 오류, 업데이트 불만, 부식·도장·단차 등 품질 불만. 고장 처리 방법 문의, 같은 증상 유경험자 문의, 정비 후기(고장 때문에 입고한 경우)도 포함.
2) 응대: 블루핸즈, 하이테크센터, 직영 서비스센터(은어: 파란손, 멍든손 등)의 AS·보증수리 응대 불만, 정비 과정·결과물 불만(재수리, 수리 후 재발, 불친절, 보증 거절 등).
3) 결품: 입고했는데 부품 재고 부족·부품 수급 문제로 정비가 지연되는 불만.`;

function keywordReference(settings) {
  return `참고 키워드 (커뮤니티 은어 포함, 이 말이 없어도 부정 이슈일 수 있음):\n${settings.keywords || ""}`;
}

const TRIAGE_SYSTEM = `너는 현대자동차·제네시스 고객 커뮤니티 모니터링 담당자다.
게시물 제목 목록을 보고, 현대차·제네시스 차량의 부정 이슈일 가능성이 있는 글을 고른다.

${ISSUE_DEFINITION}

규칙:
- 놓치면 안 되므로 조금이라도 가능성이 있으면 고른다(재현율 우선). 본문은 다음 단계에서 다시 확인한다.
- 제외: 단순 출고·시승 후기, 칭찬, 튜닝·용품·세차 이야기, 매매·시세, 결함 언급 없는 사고·블랙박스, 보험, 공지·이벤트·가입인사, 현대차·제네시스와 무관한 타 브랜드만의 이야기.
- 네이버 카페는 대부분 현대차·제네시스 차주 카페다. 자동차 커뮤니티(보배드림·클리앙·뽐뿌 등)는 현대차·제네시스 관련이 드러나거나, 차종이 안 보여도 결함·AS·부품 이슈로 보이면 고른다.
- 결과는 고른 글의 번호(id)만 돌려준다.`;

function classifySystem(settings) {
  const highlights = (settings.highlights || [])
    .filter((h) => h.car || h.topic)
    .map((h, i) => `${i + 1}. 차종 ${h.car || "(전체)"}: ${h.topic}`)
    .join("\n");
  return `너는 현대자동차·제네시스 고객 커뮤니티 모니터링 담당자다.
게시물(제목+본문)을 읽고 일일 부정 이슈 보고서에 넣을지 판정하고, 넣을 글은 구분·차종 코드·주요 내용을 정한다.

${ISSUE_DEFINITION}

판정(relevant):
- 현대차·제네시스 차량의 위 3가지 부정 이슈면 true. 아니면 false.
- false 예: 단순 후기·칭찬, 튜닝·용품, 매매, 결함과 무관한 사고, 타 브랜드만의 이야기, 내용이 없는 글, 해결 방법을 알려주는 정보글 중 불만·문제 제기가 없는 글.

구분(category): "품질", "응대", "결품" 중 하나.
- 여러 개에 해당하면 품질 > 결품 > 응대 순서로 고른다. (예: 고장으로 입고했는데 결품으로 정비 지연 → 품질)

차종 코드(car_code): 아래 코드표의 코드를 쓴다.
- 파생은 코드 뒤에 붙인다: 부분변경(페이스리프트, '더 뉴', '페리') → " PE", 전기차 → " EV", 하이브리드 → " HEV", 고성능 N → "N" 또는 표에 적힌 이름. 예: GN7 PE, NE PE, JK EV, RG3 EV, AX EV, US4 EV, CN7N
- 글에 차종·세대가 드러나면 그것을 따른다. 안 드러나면 '카페 기본 차종'을 쓴다. 그래도 모르면 빈 문자열.

주요 내용(summary): 보고서에 들어갈 짧은 한국어 명사구(대략 8~35자). 증상·불만 핵심만, 존칭·문장부호 없이.
- 예: "주행 중 우측 쏠림", "시트 레일 부식", "2열 전동 시트 작동 불가", "ICCU 결함 입고, 결품으로 정비 지연", "전기차 시스템 점검 메시지 점등 문의", "블루핸즈 수리 후 동일 증상 재발 불만"

노란색 표시(highlight): 아래 집중 관리 항목에 해당하면 true, 아니면 false.
${highlights || "(없음)"}

${keywordReference(settings)}

차종 코드표:
${settings.carCodes}`;
}

const TRIAGE_SCHEMA = {
  type: "object",
  properties: { ids: { type: "array", items: { type: "string" } } },
  required: ["ids"],
  additionalProperties: false,
};

const CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          relevant: { type: "boolean" },
          category: { type: "string", enum: ["품질", "응대", "결품"] },
          car_code: { type: "string" },
          summary: { type: "string" },
          highlight: { type: "boolean" },
        },
        required: ["id", "relevant", "category", "car_code", "summary", "highlight"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

class AiClassifier {
  constructor(settings, log) {
    this.settings = settings;
    this.log = log;
    this.model = MODELS.find((m) => m.id === settings.model) || MODELS[0];
    this.client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true, maxRetries: 4 });
    this.usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  }

  costUsd() {
    const [inP, outP] = this.model.price;
    const u = this.usage;
    return (u.input * inP + u.cacheWrite * inP * 1.25 + u.cacheRead * inP * 0.1 + u.output * outP) / 1e6;
  }

  async callJson(system, user, schema) {
    const params = {
      model: this.model.id,
      max_tokens: 16000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low", format: { type: "json_schema", schema } },
    };
    let res;
    if (this.model.fallbacks) {
      res = await this.client.beta.messages.create({
        ...params,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } else {
      res = await this.client.messages.create(params);
    }
    const u = res.usage || {};
    this.usage.input += u.input_tokens || 0;
    this.usage.output += u.output_tokens || 0;
    this.usage.cacheRead += u.cache_read_input_tokens || 0;
    this.usage.cacheWrite += u.cache_creation_input_tokens || 0;
    if (res.stop_reason === "refusal") throw new Error("AI 가 이 묶음 처리를 거절했습니다");
    if (res.stop_reason === "max_tokens") throw new Error("AI 응답이 길이 제한에 걸렸습니다");
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    return JSON.parse(text);
  }

  // 간단한 요청으로 키·모델이 되는지 확인
  async ping() {
    await this.client.messages.create({
      model: this.model.id,
      max_tokens: 64,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "OK 라고만 답해" }],
    });
  }

  // posts: [{key, source, title}] → 고른 key 의 Set
  async triage(posts) {
    const picked = new Set();
    for (let i = 0; i < posts.length; i += TRIAGE_BATCH) {
      const batch = posts.slice(i, i + TRIAGE_BATCH);
      const lines = batch.map((p, j) => `${j + 1}\t[${p.source}] ${p.title}`).join("\n");
      try {
        const out = await this.callJson(`${TRIAGE_SYSTEM}\n\n${keywordReference(this.settings)}`, `id\t[출처] 제목\n${lines}`, TRIAGE_SCHEMA);
        for (const id of out.ids || []) {
          const p = batch[+String(id).replace(/\D/g, "") - 1];
          if (p) picked.add(p.key);
        }
      } catch (e) {
        // 실패한 묶음은 키워드로 대신 고른다
        this.log(`AI 제목 선별 실패(${e.message}) → 이 묶음은 키워드로 선별`, "err");
        for (const p of batch) if (keywordHits(p.title).length) picked.add(p.key);
      }
    }
    return picked;
  }

  // items: [{key, source, carHint, title, body}] → Map(key → {relevant, category, car_code, summary, highlight})
  async classify(items) {
    const out = new Map();
    const system = classifySystem(this.settings);
    for (let i = 0; i < items.length; i += CLASSIFY_BATCH) {
      const batch = items.slice(i, i + CLASSIFY_BATCH);
      const text = batch
        .map((it, j) => {
          const body = it.body.length > BODY_CHARS ? `${it.body.slice(0, BODY_CHARS)}\n(이하 생략)` : it.body;
          return `<post id="${j + 1}">\n출처: ${it.source}\n카페 기본 차종: ${it.carHint || "(없음)"}\n제목: ${it.title}\n본문:\n${body || "(본문 없음)"}\n</post>`;
        })
        .join("\n\n");
      const result = await this.callJson(system, text, CLASSIFY_SCHEMA);
      for (const r of result.results || []) {
        const it = batch[+String(r.id).replace(/\D/g, "") - 1];
        if (it) out.set(it.key, r);
      }
    }
    return out;
  }
}
