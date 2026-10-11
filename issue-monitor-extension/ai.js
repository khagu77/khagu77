// Claude API 로 1) 제목 선별 2) 본문을 읽고 부정 이슈 판정·구분·차종·요약을 한다.

const TRIAGE_BATCH = 150; // 제목 선별 한 번에 보낼 글 수
const CLASSIFY_BATCH = 6; // 본문 판정 한 번에 보낼 글 수
const BODY_CHARS = 3000; // 본문은 앞부분만 보낸다 (비용 절약)

const ISSUE_DEFINITION = `부정 이슈는 다음 3가지다. (지난 보고서 기준 품질이 약 93%, 응대 약 6%, 결품 약 1%)
1) 품질: 차량 고장·불량·결함, 소음·진동, 누수·누유, 경고등·점검 메시지, 화면·소프트웨어·인포테인먼트 오류, 부식·도장·단차·마감, 신차 검수 불량 등 품질 불만.
   고장 처리 방법 문의, 같은 증상 유경험자 문의, 증상 공유, 무상수리·리콜 정보 공유/문의, 업데이트 관련 의견(불만·문의·후기)도 포함.
2) 응대: 블루핸즈, 하이테크 센터, 직영 서비스센터(은어: 파란손, 멍든손 등)의 정비 후기·AS·보증수리 응대 불만, 정비 과정·결과물 불만(재수리, 수리 후 재발, 불친절, 보증 거절 등), 업데이트 후기, 출고 지연·카마스터 응대 불만, 파업 등으로 인한 정비·출고 지연.
3) 결품: 입고했는데 부품 재고 부족·부품 수급 문제로 정비가 지연되는 불만.`;

function keywordReference(settings) {
  return `참고 키워드 (커뮤니티 은어 포함, 이 말이 없어도 부정 이슈일 수 있음):\n${settings.keywords || ""}`;
}

const TRIAGE_SYSTEM = `너는 현대자동차·제네시스 고객 커뮤니티 모니터링 담당자다.
게시물 제목 목록을 보고, 현대차·제네시스 차량의 부정 이슈일 가능성이 있는 글을 고른다.

${ISSUE_DEFINITION}

규칙:
- 놓치면 안 되므로 조금이라도 가능성이 있으면 고른다(재현율 우선). 본문은 다음 단계에서 다시 확인한다.
- 제외: 문제 언급 없는 출고·시승 후기, 칭찬, 튜닝·용품·세차 이야기, 매매·시세, 결함 언급 없는 사고·블랙박스, 보험, 공지·이벤트·가입인사, 현대차·제네시스와 무관한 타 브랜드만의 이야기.
- 제외: 출석 도장·출근 도장·퇴근 도장·출석 체크 글 (여기서 '도장'은 도색이 아님).
- 제외: 신차 출고 대기·출고 기다림 같은 기대·설렘 글(불만 없는 출고 대기 이야기), 신차 검수·PPF·썬팅·광택 등 업체의 홍보·광고 글, 정기 소모품 교환만 다룬 글.
- 자동차 커뮤니티(보배드림·클리앙·뽐뿌 등)의 단순 뉴스·기사 공유, 해외 이슈 공유(해외 리콜·해외 시장·해외 소비자 소식 등)는 제외한다. 다만 국내 차주의 실제 피해 사례를 옮겨 온 글은 고른다.
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
- false 예: 문제 언급 없는 출고 후기·칭찬, 튜닝·용품, 매매, 결함과 무관한 사고, 타 브랜드만의 이야기, 내용이 없는 글.
- 무상수리·리콜 정보 공유/문의, 업데이트 관련 의견, 정비 후기는 true (지난 보고서에 포함돼 왔음).
- 출석 도장·출근 도장·퇴근 도장·출석 체크 글은 무조건 false ('도장'이 도색이 아님).
- 불만 없는 신차 출고 대기·출고 기다림 글, 업체의 신차 검수·PPF·썬팅·광택 홍보·광고 글, 문제 없는 정기 소모품 교환(엔진오일 등) 후기는 false. 단, 차주가 신차 검수 중 직접 발견한 불량, 출고 지연 불만은 true.
- 자동차 커뮤니티(보배드림·클리앙·뽐뿌 등) 글 중 단순 뉴스·기사 공유, 해외 이슈 공유(해외 리콜·해외 시장·해외 소비자 소식 등)는 false. 국내 차주의 실제 경험·피해 사례(퍼온 글 포함)는 true.

구분(category): "품질", "응대", "결품" 중 하나.
- 여러 개에 해당하면 품질 > 결품 > 응대 순서로 고른다. (예: 고장으로 입고했는데 결품으로 정비 지연 → 품질)

차종 코드(car_code): 아래 코드표의 코드를 쓴다.
- 파생은 코드 뒤에 붙인다: 부분변경(페이스리프트, '더 뉴', '페리') → " PE", 전기차 → " EV", 하이브리드 → " HEV", 고성능 N → "N" 또는 표에 적힌 이름. 예: GN7 PE, NE PE, JK EV, RG3 EV, AX EV, US4 EV, CN7N
- 글에 "23년식", "24년형", "2022년 출고" 같은 연식이 나오면 코드표의 적용 시기로 세대를 정한다 (예: 21년식 팰리세이드 → LX2, 25년식 팰리세이드 → LX3, 20년식 아반떼 → AD PE 또는 CN7 중 글 내용으로). '계열'이라는 말은 빼고 코드만 쓴다.
- 글에 차종·세대·연식이 드러나면 그것을 따른다. 안 드러나면 '카페 기본 차종'(여러 개면 앞쪽이 가장 흔함) 중에서 고른다. 그래도 모르면 "-".

주요 내용(summary): 보고서에 들어갈 짧은 한국어 명사구(보통 6~20자, 복합 사안만 길게). 존칭·문장부호 없이, 아래 지난 보고서의 표준 표현을 최대한 그대로 쓴다.
- 품질 예: "도장 불량", "시트 불량", "배터리 방전", "엔진 경고등 점등", "카메라 화면 표시 오류", "하이브리드 시스템 점검 메시지 표시", "전기차 시스템 점검 메시지 표시", "하부 소음", "각종 불량", "계기반 화면 표시 불가", "주행 중 소음", "무상 수리 정보 공유", "각종 경고등 점등", "브레이크 소음", "스티어링 휠 소음", "가속 불가", "시트 작동 오류", "AVN 화면 표시 오류", "주행 중 우측 쏠림", "공조기 소음", "엔진 부조", "에어컨 작동 불량", "빌트인캠 작동 오류", "오일 누유", "도어 개폐 오류", "완속 충전 불가", "냉각수 누수", "시동 불가", "고주파음 발생", "업데이트 관련 의견", "무상 수리 정보 문의"
- 응대 예: "블루핸즈 정비 후기", "하이테크 센터 정비 후기", "BMS 업데이트 후기", "출고 지연", "무상 수리 후기", "카마스터 응대 후기", "파업으로 인한 정비 지연 불만", "선루프 누수, 하이테크 센터 응대 불만"
- 결품 예: "고전압 배터리 결품 지연", "ICCU 부품 결품", "빌트인캠 결품 지연", "헤드램프 부품 결품으로 정비 지연", "범퍼 결품 지연"
- 문의 글은 끝에 "문의", 후기는 "후기", 재발은 "재발생"을 붙인다. 예: "전기차 시스템 점검 메시지 점등 문의", "시트 불량 정비 후기"

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
