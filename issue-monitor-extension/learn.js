// 자동 학습 메모: 담당자가 결과 표에서 고친 내용(차종·구분·주요 내용·노란색·보고 필요·삭제)을
// 'AI 가 처음 정한 값 → 담당자가 고친 값' 으로 모아 두고, 다음 판정부터 AI 프롬프트에 '담당자 수정 사례'로 넣는다.
// (같은 실수를 반복하지 않게. 명령 프롬프트 화면에서 보고 지울 수 있음)

const LEARN_MAX = 200; // 보관 개수
const LEARN_PROMPT_MAX = 60; // 프롬프트에 넣는 최근 사례 수
let learnedCache = [];

async function loadLearned() {
  const { learned = [] } = await chrome.storage.local.get("learned");
  learnedCache = Array.isArray(learned) ? learned : [];
  return learnedCache;
}

async function saveLearned(list) {
  learnedCache = list.slice(0, LEARN_MAX);
  await chrome.storage.local.set({ learned: learnedCache, learnedUpdatedAt: Date.now() });
}

// AI(또는 키워드)가 처음 정한 값과 지금 값을 비교 → 바뀐 것만
function learnDiff(r) {
  if (!r.ai) return null;
  const ch = {};
  const t = (v) => String(v ?? "").trim();
  if (t(r.car) !== t(r.ai.car)) ch.car = [t(r.ai.car), t(r.car)];
  if (t(r.category) !== t(r.ai.category)) ch.category = [t(r.ai.category), t(r.category)];
  if (t(r.summary) !== t(r.ai.summary)) ch.summary = [t(r.ai.summary), t(r.summary)];
  if (!!r.highlight !== !!r.ai.highlight) ch.highlight = [!!r.ai.highlight, !!r.highlight];
  if (r.aiReport !== undefined && !!r.report !== !!r.aiReport) ch.report = [!!r.aiReport, !!r.report];
  return Object.keys(ch).length ? ch : null;
}

function learnBase(r) {
  return {
    key: urlKey(r.url),
    at: Date.now(),
    community: r.community || "",
    title: String(r.title || "").slice(0, 80),
    excerpt: String(r.excerpt || "").replace(/\s+/g, " ").slice(0, 120),
  };
}

const learnTimers = new Map();
// 결과 표에서 한 행을 고칠 때마다 (1.5초 모아서) 저장. 원래대로 되돌리면 그 사례는 지운다
function learnRow(r) {
  if (!r || !r.ai) return;
  const key = urlKey(r.url);
  clearTimeout(learnTimers.get(key));
  learnTimers.set(
    key,
    setTimeout(async () => {
      learnTimers.delete(key);
      const list = (await loadLearned()).filter((x) => !(x.key === key && x.type === "edit"));
      const ch = learnDiff(r);
      if (ch) list.unshift({ ...learnBase(r), type: "edit", ch });
      await saveLearned(list);
    }, 1500)
  );
}

// 담당자가 지운 글 = 보고서에 넣지 않을 글
async function learnDelete(rows) {
  const del = rows.filter((r) => r && r.ai);
  if (!del.length) return;
  const keys = new Set(del.map((r) => urlKey(r.url)));
  const list = (await loadLearned()).filter((x) => !keys.has(x.key));
  for (const r of del) list.unshift({ ...learnBase(r), type: "delete", car: r.car || "", category: r.category || "", summary: r.summary || "" });
  await saveLearned(list);
}

function learnLine(x) {
  const head = `- [${x.community}] 「${x.title}」`;
  if (x.type === "delete") return `${head} (판정했던 것: ${x.car} · ${x.category} · ${x.summary}) → 담당자가 보고서에서 뺌. 이런 글은 넣지 않는다`;
  const parts = [];
  const c = x.ch || {};
  if (c.car) parts.push(`차종 ${c.car[0] || "-"} → ${c.car[1] || "-"}`);
  if (c.category) parts.push(`구분 ${c.category[0]} → ${c.category[1]}`);
  if (c.summary) parts.push(`주요 내용 "${c.summary[0]}" → "${c.summary[1]}"`);
  if (c.highlight) parts.push(c.highlight[1] ? "노란색 표시 추가" : "노란색 표시 해제");
  return parts.length ? `${head} → ${parts.join(" / ")}` : "";
}

// AI 프롬프트에 넣을 '담당자 수정 사례' (kind: classify | triage | report)
function learnedSection(kind) {
  const list = (learnedCache || []).slice(0, LEARN_PROMPT_MAX);
  let lines = [];
  if (kind === "triage") {
    lines = list.filter((x) => x.type === "delete").map((x) => `- [${x.community}] 「${x.title}」`);
    if (!lines.length) return "";
    return `\n\n담당자가 보고서에서 뺀 글 제목 (자동 학습, 최근 순): 이와 같은 성격의 글은 고르지 않는다.\n${lines.join("\n")}`;
  }
  if (kind === "report") {
    lines = list
      .filter((x) => x.type === "edit" && x.ch && x.ch.report)
      .map((x) => `- [${x.community}] 「${x.title}」 → 담당자가 보고 필요에서 ${x.ch.report[1] ? "추가함 (이런 글은 고른다)" : "뺌 (이런 글은 고르지 않는다)"}`);
    if (!lines.length) return "";
    return `\n\n담당자 보고 필요 수정 사례 (자동 학습, 최근 순):\n${lines.join("\n")}`;
  }
  lines = list.map(learnLine).filter(Boolean);
  if (!lines.length) return "";
  return `\n\n담당자 수정 사례 (자동 학습, 최근 순): 담당자가 결과를 직접 고친 기록이다. 같은 판단 실수를 반복하지 말고, 비슷한 글은 담당자가 고친 쪽(차종·구분·표현·제외 여부)을 따른다.\n${lines.join("\n")}`;
}
