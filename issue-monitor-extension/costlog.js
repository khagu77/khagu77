// 섹션별 AI 비용 기록 (담당자 요청 2026-11-20: 수집 비용처럼 PPT·월간 보고서 비용도 데일리 DB 에서 확인)
// chrome.storage.local "aiCostLog" = { "ppt|2026-11-20": {section, key, usd, calls, inTok, outTok, at}, "monthly|2026-11": {...} }
//  - ppt: PPT·RAW 작성(글 요약·제목·댓글 반응·수정 요청)의 AI 비용, 키 = 보고 날짜
//  - monthly: 월간 실적 보고 AI 개요·주요 이슈 작성 비용, 키 = 보고 월
//  (수집 비용은 데일리 DB 수집 기록마다 따로 저장돼 있음)
(function (global) {
  const KEY = "aiCostLog";
  // 1백만 토큰당 달러: [입력, 출력, 캐시 읽기] (캐시 쓰기는 입력의 1.25배)
  const PRICES = {
    "claude-opus-5-5": [4, 20, 0.2],
    "claude-sonnet-5-5": [2, 10, 0.2],
    "claude-haiku-5-5": [0.1, 0.5, 0.01],
  };
  let chain = Promise.resolve(); // 동시에 여러 번 기록해도 서로 덮어쓰지 않게 차례로
  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function usdOf(model, usage) {
    if (!usage) return { usd: 0, inTok: 0, outTok: 0 };
    const [pin, pout, pread] = PRICES[model] || PRICES["claude-opus-5-5"];
    const input = usage.input_tokens || 0;
    const write = usage.cache_creation_input_tokens || 0;
    const read = usage.cache_read_input_tokens || 0;
    const output = usage.output_tokens || 0;
    return { usd: (input * pin + write * pin * 1.25 + read * pread + output * pout) / 1e6, inTok: input + write + read, outTok: output };
  }

  function addUsd(section, key, usd, inTok = 0, outTok = 0) {
    if (!section || !key || !(usd > 0)) return chain;
    chain = chain
      .then(async () => {
        const r = await chrome.storage.local.get(KEY);
        const log = r[KEY] || {};
        const k = `${section}|${key}`;
        const e = log[k] || { section, key, usd: 0, calls: 0, inTok: 0, outTok: 0 };
        e.usd += usd;
        e.calls++;
        e.inTok += inTok;
        e.outTok += outTok;
        e.at = Date.now();
        log[k] = e;
        await chrome.storage.local.set({ [KEY]: log, aiCostUpdatedAt: Date.now() });
      })
      .catch(() => {});
    return chain;
  }

  // 작업 소요 시간 누적 (ms) — 데일리 DB '소요' 칸 (담당자 요청 2026-11-20)
  function addTime(section, key, ms) {
    if (!section || !key || !(ms > 0)) return chain;
    chain = chain
      .then(async () => {
        const r = await chrome.storage.local.get(KEY);
        const log = r[KEY] || {};
        const k = `${section}|${key}`;
        const e = log[k] || { section, key, usd: 0, calls: 0, inTok: 0, outTok: 0 };
        e.ms = (e.ms || 0) + ms;
        e.runs = (e.runs || 0) + 1;
        e.at = Date.now();
        log[k] = e;
        await chrome.storage.local.set({ [KEY]: log, aiCostUpdatedAt: Date.now() });
      })
      .catch(() => {});
    return chain;
  }

  function addUsage(section, key, model, usage) {
    const c = usdOf(model, usage);
    return addUsd(section, key, c.usd, c.inTok, c.outTok);
  }

  async function all() {
    const r = await chrome.storage.local.get(KEY).catch(() => ({}));
    return r[KEY] || {};
  }

  global.CostLog = { addUsd, addUsage, addTime, all, dayKey, usdOf };
})(typeof window !== "undefined" ? window : self);
