// 수집 화면의 5단계 탭 (이슈 모니터링 보고서 작성 프로그램과 같은 흐름)
//  ① 목적·기간·키워드 ② 게시글 수집 ③ 댓글 수집 ④ 성향 분석 ⑤ 보고서·DB
// ksf.js 다음에 불러온다 (ksf.js 의 items · reactions · carStats · topThemes 등을 씀)

// ---------------------------------------------------------------------------
// 탭 · 작업 요약 줄
// ---------------------------------------------------------------------------

function showTab(n) {
  n = String(n);
  for (const sec of document.querySelectorAll("section.tab")) sec.hidden = sec.dataset.tab !== n;
  for (const a of document.querySelectorAll("#steps a")) a.classList.toggle("on", a.dataset.tab === n);
  try {
    localStorage.setItem("ksfTab", n);
  } catch {
    /* 무시 */
  }
  renderTabs();
  window.scrollTo({ top: 0 });
}

const currentTab = () => document.querySelector("#steps a.on")?.dataset.tab || "1";

// 탭마다 다시 그릴 것 (보이는 탭만)
function renderTabs() {
  renderWorkBar();
  const t = currentTab();
  if (t === "1") renderKeywordPreview();
  if (t === "2") renderPostStat();
  if (t === "3") renderCmtTab();
  if (t === "4") renderCommentList();
  if (t === "5") renderReportEdit();
}

function renderWorkBar() {
  const checked = items.filter((x) => x.checked);
  const cs = reportComments();
  const rs = reactions();
  const done = rs.filter((r) => judged(r.c || r.x)).length;
  const bar = $("#workBar");
  bar.replaceChildren();
  bar.append(
    Object.assign(document.createElement("b"), { textContent: `작업 중인 보고서: ${reportTitle()}` }),
    ` · 게시글 ${checked.length.toLocaleString()}/${items.length.toLocaleString()} · 댓글 ${cs.length.toLocaleString()} · 성향 ${done.toLocaleString()}/${rs.length.toLocaleString()} · 기간 ${periodText()}`,
  );
}

// 세그먼트 버튼 (전체 · 아반떼 · 그랜저 …)
function segButtons(box, values, current, onPick) {
  box.replaceChildren();
  for (const [v, label] of values) {
    const b = document.createElement("button");
    b.className = `seg-btn${v === current ? " on" : ""}${/^(긍정|중립|부정|단순비난)$/.test(v) ? ` t-${v}` : ""}`;
    b.textContent = label;
    b.addEventListener("click", () => onPick(v));
    box.append(b);
  }
}

// ---------------------------------------------------------------------------
// ① 목적 · 기간 · 키워드
// ---------------------------------------------------------------------------

function renderKeywordPreview() {
  const plan = keywordPlan();
  const nCafe = cafes().length;
  const box = $("#kwPreview");
  const shown = plan.queries.slice(0, 60).map((q) => `"${q}"`).join(", ");
  box.textContent =
    `검색어 ${plan.queries.length}개: ${shown}${plan.queries.length > 60 ? " …" : ""}` +
    (plan.minus.length ? ` · 제외: ${plan.minus.join(", ")}` : "") +
    ` → 동호회 ${nCafe}곳마다 검색 (모두 ${(plan.queries.length * nCafe).toLocaleString()}번 · 약 ${formatDuration(plan.queries.length * nCafe * 1.5 * SEC_PER_PAGE)})`;
  box.className = `hint kwprev${plan.queries.length * nCafe > 200 ? " err" : ""}`;
  if (plan.queries.length * nCafe > 200) box.textContent += " ⚠ 검색이 많아 오래 걸립니다. 줄을 줄이거나 | 로 묶은 말을 줄여 주세요.";
}

const KW_SYSTEM = `너는 현대자동차 온라인 여론 모니터링 담당자다. 보고서 작성 목적을 읽고, 네이버 카페(차종 동호회) 안에서 검색할 키워드를 만든다.
[형식] 한 줄 = 검색어 하나(줄끼리 '또는') · 한 줄 안의 띄어 쓴 단어 = 모두 들어간 글('그리고') · A|B = A 또는 B · -단어 = 그 말이 들어간 글 빼기
[규칙]
- 동호회 자체가 차종 카페라 차종 이름을 모든 줄에 붙일 필요는 없다. 행사 이름(코리아세일페스타·코세페·K-세일 페스타 등 표기 변형)과 행사 관련 반응 단어(할인·보상·프로모션 등)를 중심으로.
- 6~12줄. 한 줄을 펼친 검색어가 너무 많아지지 않게 (줄마다 조합 8개 이하).
- 관련 없는 글을 끌어올 말(보험 할인 등)은 -단어 로 뺀다.`;

async function suggestKeywords() {
  if (running) return;
  if (!aiOn()) return askAlert("키워드 추천은 Claude AI 를 씁니다. ① 탭 아래 'Claude AI 설정'에서 API 키를 넣어 주세요.");
  const model = $("#aiModel").value;
  if (!(await askConfirm(`보고서 작성 목적으로 수집 키워드를 Claude AI 가 추천합니다 (예상 비용 ${fmtWon(aiCostWon(2500, 600, model))}).\n추천을 받으면 지금 키워드를 바꿉니다. 계속할까요?`))) return;
  $("#suggestKw").disabled = true;
  try {
    const client = new Anthropic({ apiKey: $("#aiKey").value.trim(), dangerouslyAllowBrowser: true, maxRetries: 3 });
    const schema = { type: "object", properties: { lines: { type: "array", items: { type: "string" } } }, required: ["lines"], additionalProperties: false };
    const { msg, parsed } = await callAi(client, model, KW_SYSTEM, schema,
      `${purposeText()}대상 동호회: ${cafes().map((c) => `${c.car} ${c.name}`).join(", ")}\n지금 키워드:\n${$("#keywords").value}\n\n추천 키워드 줄(lines)을 돌려줘.`, "low");
    chargeAi(msg, model, { input: 0, output: 0 });
    const lines = (parsed.lines || []).map((l) => String(l).trim()).filter(Boolean);
    if (lines.length) {
      $("#keywords").value = lines.join("\n");
      await saveSettings();
      renderKeywordPreview();
      updateJobInfo();
      setSummary(`✔ 키워드 ${lines.length}줄을 추천받아 넣었습니다. 필요하면 고쳐 쓰세요.`, "ok");
    }
  } catch (e) {
    setSummary(`키워드 추천을 하지 못했습니다: ${aiErrorMessage(e)}`, "err");
  }
  $("#suggestKw").disabled = false;
}

function setRange(fromDate, toDate) {
  const f = (d) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  $("#startDate").value = f(fromDate);
  $("#endDate").value = f(toDate);
  saveSettings();
  updateJobInfo();
  renderResults();
}

// ---------------------------------------------------------------------------
// ② 게시글 수집
// ---------------------------------------------------------------------------

let carView = "";

function renderPostStat() {
  segButtons($("#carSeg"), [["", "전체"], ...targetCars().map((c) => [c, c])], carView, (v) => {
    carView = v;
    $("#carFilter").value = v;
    renderResults();
  });
  const checked = items.filter((x) => x.checked);
  const byCar = targetCars().map((c) => `${c} ${checked.filter((x) => x.car === c).length}`).join(" · ");
  const rs = reactions().filter((r) => !r.c);
  const n = toneCounts(rs);
  const pct = (k) => (rs.length ? ` (${fmtPct(n[k] / rs.length)})` : "");
  const box = $("#postStat");
  box.replaceChildren();
  box.append(Object.assign(document.createElement("div"), { innerHTML: `<b>체크한 게시글 ${checked.length.toLocaleString()}건 / 후보 ${items.length.toLocaleString()}건</b> (${byCar})` }));
  const line = document.createElement("div");
  line.append(`게시글 자체 성향 (차종별 반응 ${rs.length.toLocaleString()}건): `);
  for (const t of TONES) line.append(Object.assign(document.createElement("b"), { className: `t-${t}`, textContent: `${t} ${n[t]}건${pct(t)}` }), " · ");
  line.append(" — 차종별 긍/중/부/단: ");
  for (const c of targetCars()) {
    const m = toneCounts(rs.filter((r) => r.car === c));
    line.append(`${c}: `, ...TONES.flatMap((t, k) => [Object.assign(document.createElement("b"), { className: `t-${t}`, textContent: m[t] }), k < 3 ? "/" : ""]), "  ");
  }
  box.append(line);
}

async function downloadNow(makeFn, msgSel) {
  if (!reportItems().length) {
    $(msgSel).className = "hint err";
    $(msgSel).textContent = "기간 안의 체크한 글이 없습니다.";
    return;
  }
  try {
    const f = await makeFn();
    const where = await saveBytes(f.bytes, f.name);
    $(msgSel).className = "hint ok";
    $(msgSel).textContent = `✔ ${where}에 ${f.name} 저장`;
  } catch (e) {
    $(msgSel).className = "hint err";
    $(msgSel).textContent = `엑셀을 만들지 못했습니다: ${e.message}`;
  }
}

// ---------------------------------------------------------------------------
// ③ 댓글 수집
// ---------------------------------------------------------------------------

function renderCmtTab() {
  const list = sortedItems().filter((x) => x.checked || (!x.touched && x.candidate && !x.bodyRead));
  const checked = items.filter((x) => x.checked);
  const read = checked.filter((x) => x.bodyRead);
  const failed = items.filter((x) => (x.checked || x.candidate) && /못 읽음/.test(x.bodyNote || ""));
  $("#cmtStat").textContent =
    `체크한 글 ${checked.length.toLocaleString()}건 중 본문·댓글 읽음 ${read.length.toLocaleString()}건 · 댓글 ${reportComments().length.toLocaleString()}개 (기간 안)` +
    (failed.length ? ` · 못 읽은 글 ${failed.length}건` : "") + (items.some((x) => x.recollectAt) ? ` · 마지막 새 댓글 수집 ${new Date(Math.max(...items.map((x) => x.recollectAt || 0))).toLocaleString()}` : "");
  const tbody = $("#cmtTable tbody");
  tbody.replaceChildren();
  for (const x of list.slice(0, 800)) {
    const tr = document.createElement("tr");
    if (!x.checked) tr.className = "off";
    const inP = (x.commentList || []).filter((c) => inPeriodTime(c.date)).length;
    const st = !x.bodyRead ? (x.bodyNote || "아직 안 읽음") : x.bodyNote || `✔ 읽음${x.recollectAt ? ` · 새 댓글 확인 ${new Date(x.recollectAt).toLocaleString()}` : ""}`;
    const a = Object.assign(document.createElement("a"), { href: articleUrl(x), target: "_blank", rel: "noopener", textContent: x.title });
    const tds = [x.car, x.cafeName, a, x.date ? formatDateTime(new Date(x.date), x.hasTime) : "", x.commentsRead ? `${inP.toLocaleString()}${inP !== (x.commentList || []).length ? ` / 전체 ${(x.commentList || []).length}` : ""}` : "-", st];
    for (const v of tds) {
      const td = document.createElement("td");
      td.append(v);
      tr.append(td);
    }
    tbody.append(tr);
  }
  if (!list.length) tbody.innerHTML = `<tr><td colspan="6" class="hint">② 게시글 수집 탭에서 글을 찾고 체크해 주세요.</td></tr>`;
}

// 새 댓글 다시 수집: 이미 읽은 체크한 글을 다시 열어 그 뒤에 달린 댓글만 더한다 (이미 판단한 댓글·담당자 수정은 그대로)
async function recollect() {
  if (running) return;
  const todo = sortedItems().filter((x) => x.checked && x.bodyRead && !x.bodyNote);
  if (!todo.length) return setSummary("다시 볼 글이 없습니다 (본문·댓글을 읽은 체크한 글).", "err");
  if (!(await askConfirm(`이미 읽은 체크한 글 ${todo.length.toLocaleString()}개를 다시 열어 새로 달린 댓글을 더합니다 (약 ${formatDuration(todo.length * SEC_PER_ARTICLE)}).\n이미 모은 댓글과 성향 판단은 그대로 둡니다. 계속할까요?`))) return;
  await checkLogin();
  startBusy();
  const t0 = Date.now();
  let added = 0;
  let gone = 0;
  const keyOf = (c) => c.id || `${c.nickname}|${c.dateText}|${c.content}`;
  for (let i = 0; i < todo.length && !stopRequested; i++) {
    const x = todo[i];
    showBusy(`새 댓글 수집 중 ${i + 1}/${todo.length} · ${x.cafeName}${estimateRemaining(t0, i, todo.length, (todo.length - i) * SEC_PER_ARTICLE)} — 끝날 때까지 이 탭을 닫지 마세요`, i, todo.length, "새 댓글 수집 중");
    if (i) await sleep(randomBetween(CAFE_ARTICLE_DELAY));
    const res = await readPost(articleUrl(x));
    if (res.login) {
      log("✖ 네이버 로그인이 필요합니다 - 로그인한 뒤 다시 누르세요");
      break;
    }
    if (!res.found || res.locked || res.deleted) {
      log(`· 다시 열지 못함: ${x.title}${res.deleted ? " (삭제됨)" : ""}`);
      continue;
    }
    const have = new Map((x.commentList || []).map((c) => [keyOf(c), c]));
    const fresh = res.commentList || [];
    const freshKeys = new Set(fresh.map(keyOf));
    let n = 0;
    for (const c of fresh) {
      if (!have.has(keyOf(c))) {
        x.commentList.push(c);
        n++;
      }
    }
    gone += (x.commentList || []).filter((c) => !freshKeys.has(keyOf(c))).length;
    added += n;
    if (typeof res.comments === "number") x.comments = res.comments;
    if (typeof res.views === "number") x.views = res.views;
    x.recollectAt = Date.now();
    if (n) log(`· ${x.cafeName} '${x.title}': 새 댓글 ${n}개`);
    if (i % 5 === 4) await saveItems();
  }
  await saveItems();
  endBusy();
  renderResults();
  setSummary(
    `${stopRequested ? "중지됨 - " : "✔ "}새 댓글 ${added.toLocaleString()}개를 더했습니다 (글 ${todo.length.toLocaleString()}개 확인 · ${formatDuration((Date.now() - t0) / 1000)})` +
      (gone ? ` · 그 사이 지워진 것으로 보이는 댓글 ${gone}개는 그대로 둠` : "") +
      (added && aiOn() ? " · ④ 성향 분석 탭에서 '💰 AI 성향 분석 시작'을 누르면 새 댓글만 판단" : ""),
    "ok",
  );
  if (!stopRequested) playChime();
  stopRequested = false;
}

// ---------------------------------------------------------------------------
// ④ 성향 분석: 댓글별 성향 (차종 · 성향 필터 · 검색 · 바로 고치기)
// ---------------------------------------------------------------------------

let cCar = "";
let cTone = "";
let cType = "";
let cLimit = 200;

function renderCommentList() {
  segButtons($("#cCarSeg"), [["", "전체"], ...targetCars().map((c) => [c, c])], cCar, (v) => ((cCar = v), (cLimit = 200), renderCommentList()));
  segButtons($("#cToneSeg"), [["", "전체"], ...TONES.map((t) => [t, t]), ["미분석", "미분석"]], cTone, (v) => ((cTone = v), (cLimit = 200), renderCommentList()));
  segButtons($("#cTypeSeg"), [["", "유형 전체"], ...PTYPE_NAMES.map((t) => [t, t])], cType, (v) => ((cType = v), (cLimit = 200), renderCommentList()));
  const q = compactText($("#cSearch").value);
  const list = reactions().filter((r) => r.c).filter((r) =>
    (!cCar || r.car === cCar) &&
    (!cTone || (cTone === "미분석" ? !judged(r.c) : r.tone === cTone)) &&
    (!cType || r.ptype === cType) &&
    (!q || compactText(r.c.content).includes(q)));
  const tbody = $("#cList tbody");
  tbody.replaceChildren();
  for (const r of list.slice(0, cLimit)) {
    const tr = document.createElement("tr");
    const td = (v, cls = "") => {
      const d = document.createElement("td");
      if (cls) d.className = cls;
      d.append(v);
      return d;
    };
    const text = document.createElement("div");
    text.textContent = r.c.content;
    if (r.c.isReply && r.c.parentText) text.title = `앞 댓글: ${r.c.parentText}`;
    if (r.reason) text.append(Object.assign(document.createElement("div"), { className: "hint small", textContent: `근거: ${r.reason}${r.theme ? ` · ${r.theme}` : ""}` }));
    const a = Object.assign(document.createElement("a"), { href: articleUrl(r.x), target: "_blank", rel: "noopener", textContent: r.x.title });
    tr.append(td(r.car), td(r.kind), td(text), td(a, "post"), td(typeSelect(r.c, r.c.content, () => renderCommentList()), "nowrap"), td(toneSelect(r.c, r, () => renderWorkBar()), "nowrap"));
    if (!judged(r.c)) tr.className = "unjudged";
    tbody.append(tr);
  }
  if (!list.length) tbody.innerHTML = `<tr><td colspan="6" class="hint">${reportComments().length ? "조건에 맞는 댓글이 없습니다." : "③ 댓글 수집 탭에서 댓글을 먼저 모아 주세요."}</td></tr>`;
  $("#cCount").textContent = `${list.length.toLocaleString()}개 중 ${Math.min(cLimit, list.length).toLocaleString()}개 표시 · 성향을 고르면 바로 반영 (고친 것은 '담당자 수정'으로 표시되고 다시 분석해도 그대로)`;
  $("#cMore").hidden = list.length <= cLimit;
}

// ---------------------------------------------------------------------------
// ⑤ 보고서 초안: 2줄 요약 · 대표 댓글 (AI 가 쓰고 담당자가 고침) → PPT 1·2페이지 · 대시보드
// ---------------------------------------------------------------------------

const REPORT_RULES = `★ 보고서 작성 규칙 ★
1. 보고서 작성 목적에 초점을 맞춰, 목적과 관련된 여론의 흐름이 한눈에 보이게 쓴다. 숫자(성향 비율·건수)는 주어진 통계와 반드시 일치시킨다.
2. 문체는 현대자동차 내부 여론 동향 보고서체: 짧은 개조식, '~확인 中', '~다수 확인', '~지배적', '~일부 확인', '比'(대비), '內'(안) 같은 표현을 쓴다. 존댓말·느낌표·이모티콘을 쓰지 않는다.
   예) "11/1 코리아 세일 페스타 시작 이후 대상 차종 동호회 內 할인 조건 공유와 함께 기존 구매자 역차별 불만 다수 확인 中"
   예) "주요 부정 여론은 기존 구매자 보상 요구 및 재고 처리용 할인 인식이며, 그랜저 동호회 중심으로 충성 고객 기만 불만 확인. 한편 할인을 계기로 한 구매 검토 여론 일부 확인"
3. summary 는 정확히 2문장(두 줄 글머리표): 첫째 = 행사 시점·전체 여론 흐름, 둘째 = 주요 부정(또는 우세한) 여론의 구체적 내용과 차종별 특징, 그리고 반대 성향 여론.
   ★ 길이: PPT 요약 칸에 문장마다 한 줄 → 각 문장 공백 포함 55자 이내(최대 60자). 비율 숫자는 핵심 1~2개만.
   ★ 실제 댓글·게시글에 가장 많이 등장한 논점(주어진 차종별 TOP5 와 건수)을 많이 나온 순서대로 짚는다. 드물게 나온 이야기를 주요 여론처럼 쓰지 않는다.
   ★ 근거 없는 내용 금지 · 중립 여론·중립 비율은 summary 에 쓰지 않는다.
   ★ 커뮤니티 은어·속어(호구, 현기, 흉기 등)는 요약 문장에 쓰지 않고 보고서 용어로 바꾼다 (단, 주요 댓글 샘플은 원문 그대로).
4. title 은 "<이슈명> 관련 여론 동향" 형태로 25자 이내.
5. 주요 댓글은 반드시 주어진 댓글 목록에서 id 로 고른다 (새로 지어내지 않는다). quotes_short·quotes_long 에는 id(예: "c12")만 넣는다.
   - 선정 우선순위: 목적(코세페 반응)에 딱 맞으면서 반응이 센 댓글(강한 감정, 직설적인 불만, 구체적인 금액·비교)을 앞에. 같은 말을 되풀이하는 댓글은 하나만, 차종·논점이 고루 보이게.
   - 'ㅋㅋㅋ'만 많거나 내용 없는 댓글, 개인 신상이 드러난 댓글은 고르지 않는다.
   - quotes_short (1페이지): 성향마다 4~7개, 짧고 센 것부터. 단 중립은 감정이 거의 없는 성의 있는 정보·질문 위주.
   - quotes_long (2페이지): 성향마다 10~25개, 1페이지에 쓰지 않은 나머지 중 중요한 것부터. 1페이지와 겹치지 않게.
6. insights (SUMMARY 의 시사점): 4~6개. 주어진 통계·차종별 TOP5·유형 구분별 숫자에 근거해 보고서 문체('~임', '~으로 판단됨', '~확인', '~필요')로 한 문장씩.
   차종 간 차이(어느 차종의 부정 여론이 높은지), 가장 많이 이야기된 이슈와 그 의미, 유형 구분별 특징(예: 기존 출고자·출고 대기자 = 혜택 미적용자의 불만),
   긍정 여론의 성격, 대응·검토가 필요한 점. 숫자는 통계와 반드시 일치. 근거 없는 추측 금지.`;

const REPORT_SCHEMA = (() => {
  const ids = { type: "object", properties: Object.fromEntries(["긍정", "중립", "부정", "단순비난"].map((s) => [s, { type: "array", items: { type: "string" } }])), required: ["긍정", "중립", "부정", "단순비난"], additionalProperties: false };
  return {
    type: "object",
    properties: { title: { type: "string" }, summary: { type: "array", items: { type: "string" } }, quotes_short: ids, quotes_long: ids, insights: { type: "array", items: { type: "string" } } },
    required: ["title", "summary", "quotes_short", "quotes_long", "insights"],
    additionalProperties: false,
  };
})();

const channelsLabel = () => `주요 모니터링 동호회 (${targetCars().map((c) => `${c} ${cafes().filter((x) => x.car === c).length}곳`).join(" · ")})`;

// 대표 댓글 후보: 성향마다 차종을 섞어, 내용 있는 댓글부터
function quotePool(per = 70) {
  const pool = {};
  const rs = reactions().filter((r) => r.c && r.c.content);
  for (const t of TONES) {
    const byCar = targetCars().map((car) => {
      const seen = new Set();
      return rs.filter((r) => r.car === car && r.tone === t)
        .filter((r) => !seen.has(r.c.content) && seen.add(r.c.content))
        .map((r) => ({ r, k: Math.min(r.c.content.length, 120) - (/(ㅋ|ㅎ){4,}/.test(r.c.content) ? 60 : 0) }))
        .sort((a, b) => b.k - a.k)
        .map((x) => x.r);
    });
    const out = [];
    for (let i = 0; out.length < per && byCar.some((a) => a.length > i); i++) for (const a of byCar) if (a[i] && out.length < per) out.push(a[i]);
    pool[t] = out;
  }
  return pool;
}

function statsForAi() {
  const stats = carStats();
  const top = topThemes();
  const lines = ["[통계 - 성향 비율은 반응(게시글·댓글 × 언급 차종) 기준]"];
  for (const s of stats) {
    lines.push(`${s.car}: 게시글 ${s.posts} · 댓글 ${s.comments} · 반응 ${s.n} · ${TONES.map((t) => `${t} ${fmtPct(s.ratio[t])}(${s.tone[t]})`).join(" · ")}`);
  }
  lines.push("", "[차종별 많이 이야기된 주요 내용 TOP5 (건수 · 그 차종 긍정/부정 중 비중)]");
  for (const car of targetCars()) {
    for (const t of ["긍정", "부정"]) lines.push(`${car} ${t}: ${top.cars[car][t].slice(0, 5).map((g) => `${g.label} ${g.count}건(${fmtPct(g.ratio)})`).join(" / ") || "없음"}`);
  }
  lines.push("", "[유형 구분별 반응 (글쓴이 유형)]");
  for (const t of typeStats()) lines.push(`${t.type}: ${t.n}건(${fmtPct(t.share)}) · 긍정 ${fmtPct(t.ratio["긍정"])} · 부정 여론 ${fmtPct(t.ratio["부정"] + t.ratio["단순비난"])}${t.top ? ` · 가장 많이 나온 여론 ${t.top.quote ? t.top.label : `[${t.top.tone}] ${t.top.label} ${t.top.count}건`}` : ""}`);
  lines.push("", "[수집 게시글 제목 일부]", ...reportItems().slice(0, 50).map((x) => `- (${x.car} ${x.cafeName}) ${x.title}`));
  return lines.join("\n");
}

async function writeReport() {
  if (running) return;
  if (!aiOn()) return askAlert("보고서 초안은 Claude AI 가 씁니다. ① 탭 아래 'Claude AI 설정'에서 API 키를 넣어 주세요. (키 없이도 아래 칸에 직접 써서 PPT 를 만들 수 있습니다)");
  if (!reactions().length) return setSummary("먼저 댓글을 모으고 성향을 분석해 주세요.", "err");
  const model = $("#aiModel").value;
  const pool = quotePool();
  const idMap = new Map();
  let n = 0;
  const lines = [];
  for (const t of TONES) {
    lines.push(`\n## ${t} 댓글 후보`);
    for (const r of pool[t]) {
      const id = `c${++n}`;
      idMap.set(id, r.c.content);
      lines.push(`${id}\t(${r.car}) ${r.c.content.replace(/\s+/g, " ").slice(0, 300)}`);
    }
  }
  const chars = lines.join("\n").length + statsForAi().length + 4000;
  if (!(await askConfirm(`Claude AI 가 보고서 초안(제목 · 2줄 요약 · 1·2페이지 성향별 대표 댓글)을 씁니다.\n예상 비용 ${fmtWon(aiCostWon(chars, 2500, model))} · 쓴 뒤 아래 칸에서 고칠 수 있습니다. 계속할까요?`))) return;
  startBusy();
  showBusy("AI 보고서 초안 작성 중…", 0, 0, "보고서 초안");
  try {
    const client = new Anthropic({ apiKey: $("#aiKey").value.trim(), dangerouslyAllowBrowser: true, maxRetries: 3 });
    const sys = `${purposeText()}너는 현대자동차 온라인 여론 모니터링 보고서 작성 담당자다. 수집·분석된 동호회 게시글과 댓글로 '여론 동향' PPT 보고서의 문장을 쓰고 대표 댓글을 고른다.\n대상 차종: ${targetCars().join(", ")} · 채널: ${channelsLabel()}\n\n${REPORT_RULES}${aiExtra()}`;
    const { msg, parsed } = await callAi(client, model, sys, REPORT_SCHEMA, `${statsForAi()}\n\n아래 후보 댓글(id\t(차종) 내용)에서 골라 줘.${lines.join("\n")}`, "high");
    chargeAi(msg, model, { input: 0, output: 0 });
    const pick = (list, skip = new Set()) => [...new Set((list || []).map((v) => idMap.get(String(v).trim().match(/c\d+/i)?.[0]?.toLowerCase())).filter(Boolean))].filter((t) => !skip.has(t));
    const short = Object.fromEntries(TONES.map((t) => [t, pick(parsed.quotes_short?.[t])]));
    const long = Object.fromEntries(TONES.map((t) => [t, pick(parsed.quotes_long?.[t], new Set(short[t]))]));
    // AI 가 고르지 못한 성향은 후보 순서대로 채움
    for (const t of TONES) {
      if (!short[t].length) short[t] = pool[t].slice(0, 5).map((r) => r.c.content);
      if (!long[t].length) long[t] = pool[t].slice(5, 25).map((r) => r.c.content);
    }
    report = {
      title: String(parsed.title || "").trim() || reportTitle(), channels: report?.channels || channelsLabel(),
      summary: (parsed.summary || []).slice(0, 2).map((x) => String(x).trim()), headline: report?.headline || "", short, long, at: Date.now(),
      insights: (parsed.insights || []).map((x) => String(x).replace(/^[-·•\s]+/, "").trim()).filter(Boolean).slice(0, 8),
    };
    await chrome.storage.local.set({ ksfReport: report }).catch(() => {});
    renderReportEdit();
    renderWorkBar();
    $("#reportMsg").className = "hint ok";
    $("#reportMsg").textContent = `✔ 초안을 썼습니다 (${new Date().toLocaleString()}). 아래에서 고친 뒤 'PPT 만들기'를 누르세요.`;
    playChime();
  } catch (e) {
    $("#reportMsg").className = "hint err";
    $("#reportMsg").textContent = `초안을 쓰지 못했습니다: ${aiErrorMessage(e)}`;
  }
  endBusy();
}

function saveReportSoon() {
  clearTimeout(saveReportSoon.t);
  saveReportSoon.t = setTimeout(() => {
    chrome.storage.local.set({ ksfReport: report }).catch(() => {});
    renderWorkBar();
    saveDashSoon();
  }, 400);
}

function renderReportEdit() {
  const r = report || {};
  const setIf = (id, v) => {
    if (document.activeElement !== $(id)) $(id).value = v || "";
  };
  setIf("#rTitle", r.title || reportTitle());
  setIf("#rChannels", r.channels || channelsLabel());
  setIf("#rSum1", (r.summary || [])[0]);
  setIf("#rSum2", (r.summary || [])[1]);
  setIf("#rHeadline", r.headline);
  setIf("#rInsights", (r.insights || []).join("\n"));
  if (!(r.insights || []).length) $("#rInsights").placeholder = `(비어 있으면 숫자로 자동 작성)\n${autoInsights().join("\n")}`;
  const all = carStats()[0];
  const neg = all.n ? all.ratio["부정"] + all.ratio["단순비난"] : 0;
  const pos = all.n ? all.ratio["긍정"] : 0;
  $("#rHeadPreview").textContent = all.n ? `머리 문장 미리보기: ${neg >= pos ? "부정 여론(부정+단순비난)이 긍정 여론" : "긍정 여론이 부정 여론(부정+단순비난)"} 比 ${$("#rHeadline").value.trim() || "(자동)"} (${fmtPct(Math.max(neg, pos))} vs ${fmtPct(Math.min(neg, pos))})` : "";
  const box = $("#rQuotes");
  if (box.contains(document.activeElement)) return;
  const pptAuto = pptReportData();
  box.replaceChildren();
  for (const t of TONES) {
    for (const [key, label] of [["short", "1페이지"], ["long", "2페이지"]]) {
      const wrap = document.createElement("label");
      wrap.className = "qbox";
      wrap.append(Object.assign(document.createElement("b"), { className: `t-${t}`, textContent: `${t} · ${label} 대표 댓글` }), Object.assign(document.createElement("span"), { className: "hint", textContent: " (한 줄에 하나 · 원문 그대로)" }));
      const ta = document.createElement("textarea");
      ta.rows = key === "short" ? 4 : 6;
      ta.value = (r[key]?.[t] || []).join("\n");
      // 비어 있으면 PPT 에 자동으로 들어갈 댓글을 흐리게 보여 줌
      if (!ta.value) ta.placeholder = `(비어 있으면 자동으로 넣음)\n${(pptAuto[key]?.[t] || []).slice(0, 6).join("\n")}`;
      ta.addEventListener("input", () => {
        report = { ...(report || {}), [key]: { ...(report?.[key] || {}), [t]: ta.value.split("\n").map((x) => x.trim()).filter(Boolean) } };
        saveReportSoon();
      });
      wrap.append(ta);
      box.append(wrap);
    }
  }
}

// PPT 1·2페이지에 넣을 값 (초안이 없으면 대표 댓글은 후보 순서대로)
function pptReportData() {
  const r = report || {};
  const pool = quotePool(40);
  const stats = {};
  for (const s of carStats()) stats[s.car] = { posts: s.posts, comments: s.comments, n: s.n, ...s.tone };
  const auto = (t, a, b) => pool[t].slice(a, b).map((x) => x.c.content);
  return {
    title: reportTitle(),
    summary: (r.summary || []).filter(Boolean),
    headline: (r.headline || "").trim(),
    from: timeOf($("#startDate").value)?.getTime() || Date.now(),
    to: timeOf($("#endDate").value)?.getTime() || Date.now(),
    channelsLabel: (r.channels || "").trim() || channelsLabel(),
    rows: targetCars(),
    stats,
    short: Object.fromEntries(TONES.map((t) => [t, r.short?.[t]?.length ? r.short[t] : auto(t, 0, 6)])),
    long: Object.fromEntries(TONES.map((t) => [t, r.long?.[t]?.length ? r.long[t] : auto(t, 6, 30)])),
  };
}

// ---------------------------------------------------------------------------
// SUMMARY: 메일 본문에 붙여 넣을 종합 결과 글 (PPT·엑셀을 만들 때 함께 새로 만듦 · 직접 고칠 수 있음)
// ---------------------------------------------------------------------------

const cnt = (n, total) => `${Number(n || 0).toLocaleString()}건 (${total ? fmtPct(n / total) : "0.0%"})`;
const negOf = (r) => (r["부정"] || 0) + (r["단순비난"] || 0);
const shortDate = (v) => {
  const d = timeOf(v);
  return d ? `'${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}` : "?";
};

// 시사점 (AI 초안이 없을 때 숫자로)
function autoInsights() {
  const stats = carStats();
  const all = stats[0];
  if (!all.n) return [];
  const cars = stats.filter((s) => targetCars().includes(s.car) && s.n);
  const out = [];
  const neg = negOf(all.ratio);
  out.push(`코리아 세일 페스타 관련 대상 차종 동호회 반응 ${all.n.toLocaleString()}건 중 부정 여론(부정+단순비난) ${fmtPct(neg)}, 긍정 ${fmtPct(all.ratio["긍정"])}로 ${neg > all.ratio["긍정"] ? "부정 여론이 우세" : "긍정 여론이 우세"}함`);
  if (cars.length > 1) {
    const hi = cars.slice().sort((a, b) => negOf(b.ratio) - negOf(a.ratio))[0];
    const lo = cars.slice().sort((a, b) => negOf(a.ratio) - negOf(b.ratio))[0];
    out.push(`차종별로는 ${hi.car}의 부정 여론이 ${fmtPct(negOf(hi.ratio))}로 가장 높고, ${lo.car}가 ${fmtPct(negOf(lo.ratio))}로 가장 낮음`);
  }
  const top = topThemes();
  const negTop = targetCars().map((c) => ({ c, g: top.cars[c]["부정"].find((g) => !/^기타/.test(g.label)) })).filter((x) => x.g).sort((a, b) => b.g.count - a.g.count)[0];
  if (negTop) out.push(`가장 많이 이야기된 부정 이슈는 ${negTop.c}의 '${negTop.g.label}'(${negTop.g.count}건, ${negTop.c} 부정 반응의 ${fmtPct(negTop.g.ratio)})임`);
  const ts = typeStats().filter((t) => t.n && t.type !== "유형 구분 외");
  const unfair = ts.filter((t) => /기존 출고자|출고 대기자/.test(t.type));
  const nUnfair = unfair.reduce((n, t) => n + t.n, 0);
  if (nUnfair) {
    const negN = unfair.reduce((n, t) => n + t.tone["부정"] + t.tone["단순비난"], 0);
    out.push(`혜택 미적용자(기존 출고자·출고 대기자) 반응 ${nUnfair}건 중 부정 여론 ${fmtPct(negN / nUnfair)}로, 기존 구매자 형평성 관련 대응 검토 필요`);
  }
  const buyers = ts.filter((t) => /행사 기간 내 계약자|계약 예정자/.test(t.type));
  const nBuy = buyers.reduce((n, t) => n + t.n, 0);
  if (nBuy) out.push(`행사 기간 내 계약자·계약 예정자 반응 ${nBuy}건 중 긍정 ${fmtPct(buyers.reduce((n, t) => n + t.tone["긍정"], 0) / nBuy)}로, 할인을 계기로 한 구매 검토 여론 확인`);
  return out;
}

function makeSummaryText() {
  const list = reportItems();
  const rs = reactions(list);
  const stats = carStats(rs);
  const all = stats[0];
  const top = topThemes(rs);
  const r = report || {};
  const cafesList = cafes();
  const L = [];
  L.push(`■ ${reportTitle()} 결과`, "");
  L.push("1. 개요");
  L.push(` - 모니터링 기간 : ${periodText()}`);
  L.push(` - 모니터링 대상 : 차종별 네이버 동호회 ${cafesList.length}곳 (${targetCars().map((c) => `${c} ${cafesList.filter((x) => x.car === c).length}곳`).join(" · ")})`);
  for (const c of targetCars()) L.push(`   · ${c} : ${cafesList.filter((x) => x.car === c).map((x) => x.name).join(", ")}`);
  L.push(` - 수집 결과 : 검색된 게시글 ${items.length.toLocaleString()}건 중 코세페 관련 게시글 ${list.length.toLocaleString()}건 선별 (${items.length ? fmtPct(list.length / items.length) : "-"}), 댓글·답글 ${all.comments.toLocaleString()}건`);
  L.push(`   → 분석 반응 ${all.n.toLocaleString()}건 (게시글·댓글 × 언급 차종, 한 글이 여러 차종을 말하면 차종마다 집계)`);
  const unj = rs.filter((x) => !judged(x.c || x.x)).length;
  L.push(` - 성향 기준 : 일반적인 말투가 아닌 '코리아 세일 페스타'에 대한 반응 기준 (긍정 · 중립 · 부정 · 단순비난)${unj ? ` ※ ${unj}건은 AI 판단 전 잠정치` : ""}`);
  L.push("");
  L.push("2. 전체 여론");
  for (const t of (r.summary || []).filter(Boolean)) L.push(` - ${t}`);
  L.push(` - 긍정 ${cnt(all.tone["긍정"], all.n)} / 중립 ${cnt(all.tone["중립"], all.n)} / 부정 ${cnt(all.tone["부정"], all.n)} / 단순비난 ${cnt(all.tone["단순비난"], all.n)}`);
  if (all.n) {
    const neg = negOf(all.ratio);
    L.push(`   → ${neg >= all.ratio["긍정"] ? "부정 여론(부정+단순비난)이 긍정 여론" : "긍정 여론이 부정 여론(부정+단순비난)"} 比 ${(r.headline || "").trim() || (Math.abs(neg - all.ratio["긍정"]) < 0.03 ? "비슷한 수준" : "높은 편")} (${fmtPct(Math.max(neg, all.ratio["긍정"]))} vs ${fmtPct(Math.min(neg, all.ratio["긍정"]))})`);
  }
  L.push("");
  L.push("3. 차종별 성향");
  for (const s of stats.filter((x) => targetCars().includes(x.car))) {
    L.push(` - ${s.car} : 게시글 ${s.posts.toLocaleString()}건 · 댓글 ${s.comments.toLocaleString()}건 · 반응 ${s.n.toLocaleString()}건 (전체 반응의 ${all.n ? fmtPct(s.n / all.n) : "-"})`);
    L.push(`   · 긍정 ${cnt(s.tone["긍정"], s.n)} / 중립 ${cnt(s.tone["중립"], s.n)} / 부정 ${cnt(s.tone["부정"], s.n)} / 단순비난 ${cnt(s.tone["단순비난"], s.n)}`);
    if (s.n) L.push(`   → 부정 여론 ${fmtPct(negOf(s.ratio))} vs 긍정 ${fmtPct(s.ratio["긍정"])}`);
  }
  L.push("");
  L.push(`4. 차종별 긍정 · 부정 주요 내용 TOP${TOP_N} (많이 이야기된 순 · 괄호 안은 그 차종 긍정/부정 반응 중 비중)`);
  for (const c of targetCars()) {
    L.push(` - ${c}`);
    for (const t of ["긍정", "부정"]) {
      const gs = top.cars[c][t].slice(0, TOP_N);
      L.push(`   · ${t} (${top.cars[c].total[t].toLocaleString()}건)${gs.length ? "" : " : 해당 없음"}`);
      gs.forEach((g, i) => L.push(`     ${i + 1}) ${g.label} ${g.count.toLocaleString()}건 (${fmtPct(g.ratio)})`));
    }
  }
  L.push("");
  L.push("5. 유형 구분별 반응 (글쓴이 유형 · 괄호 안은 전체 반응 중 비중)");
  for (const t of typeStats(rs)) {
    L.push(` - ${t.type} : ${cnt(t.n, all.n)}${t.n ? ` · 긍정 ${fmtPct(t.ratio["긍정"])} / 부정 여론 ${fmtPct(negOf(t.ratio))}` : ""}`);
    if (t.top) L.push(`   · 가장 많이 나온 여론 : ${t.top.quote ? t.top.label : `[${t.top.tone}] ${t.top.label} (${t.top.count}건)`}`);
  }
  for (const [t, , note] of PTYPES) L.push(`   ※ ${t} : ${note}`);
  L.push("");
  L.push("6. 성향별 주요 댓글");
  const pr = pptReportData();
  for (const t of TONES) {
    const qs = (pr.short[t] || []).slice(0, 4).map((q) => `‘${String(q).replace(/\s+/g, " ").trim().slice(0, 90)}’`);
    L.push(` - ${t} (${all.n ? fmtPct(all.ratio[t]) : "-"}) : ${qs.join(", ") || "-"}`);
  }
  L.push("");
  L.push("7. 시사점");
  const ins = (r.insights || []).filter(Boolean).length ? r.insights.filter(Boolean) : autoInsights();
  for (const t of ins) L.push(` - ${t}`);
  return L.join("\n");
}

async function refreshSummary(reason = "") {
  const text = makeSummaryText();
  $("#summaryText").value = text;
  await chrome.storage.local.set({ ksfSummaryText: text, ksfSummaryAt: Date.now() }).catch(() => {});
  await dbSaveDay("summaryText", today(), `${fileBase()}_SUMMARY.txt`, Zip.bytes(text), "auto", "메일 붙여넣기용 SUMMARY", null).catch(() => {});
  readyButton($("#copySummary"), true);
  $("#summaryInfo").className = "hint ok";
  $("#summaryInfo").textContent = `✔ ${reason ? `${reason} · ` : ""}SUMMARY 를 만들었습니다 (${new Date().toLocaleString()}) · 📋 복사 → 메일 본문에 붙여 넣기`;
}

function copySummary() {
  const text = $("#summaryText").value;
  if (!text.trim()) return;
  const done = () => {
    readyButton($("#copySummary"), false);
    $("#copySummary").disabled = false;
    $("#summaryInfo").className = "hint ok";
    $("#summaryInfo").textContent = "✔ 복사했습니다. 메일 본문에 붙여 넣으세요 (Ctrl+V / ⌘V).";
  };
  navigator.clipboard.writeText(text).then(done).catch(() => {
    $("#summaryText").select();
    document.execCommand("copy");
    done();
  });
}

// ---------------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------------

(async () => {
  const st = await chrome.storage.local.get(["ksfReport"]).catch(() => ({}));
  report = st.ksfReport || null;
  for (const a of document.querySelectorAll("#steps a")) a.addEventListener("click", () => showTab(a.dataset.tab));
  for (const b of document.querySelectorAll(".gotab")) b.addEventListener("click", () => showTab(b.dataset.go));
  for (const a of document.querySelectorAll(".opensettings")) a.addEventListener("click", (e) => {
    e.preventDefault();
    $("#settings").open = true;
    $("#settings").scrollIntoView({ behavior: "smooth" });
  });
  let tab = "1";
  try {
    tab = localStorage.getItem("ksfTab") || (items.length ? "2" : "1");
  } catch {
    /* 무시 */
  }
  if (location.hash === "#settings") tab = "1";
  showTab(tab);
  window.addEventListener("hashchange", () => location.hash === "#settings" && showTab("1"));
  $("#keywords").addEventListener("input", renderKeywordPreview);
  $("#suggestKw").addEventListener("click", suggestKeywords);
  $("#rangeKsf").addEventListener("click", () => setRange(timeOf(DEFAULT_START), timeOf(DEFAULT_END)));
  for (const b of document.querySelectorAll("button.range")) b.addEventListener("click", () => {
    const now = new Date();
    setRange(new Date(now.getTime() - Number(b.dataset.hours) * 3600000), now);
  });
  $("#judgePosts").addEventListener("click", () => judgeAll({ postsOnly: true }));
  $("#recollect").addEventListener("click", recollect);
  $("#cSearch").addEventListener("input", () => {
    cLimit = 200;
    renderCommentList();
  });
  $("#cMore").addEventListener("click", () => {
    cLimit += 300;
    renderCommentList();
  });
  $("#reanalyze").addEventListener("click", async () => {
    if (!$("#reInstr").value.trim()) return askAlert("재분석 지시사항을 적어 주세요.");
    await chrome.storage.local.set({ ksfReInstr: $("#reInstr").value }).catch(() => {});
    judgeAll({ force: true });
  });
  $("#reInstr").value = (await chrome.storage.local.get("ksfReInstr").catch(() => ({}))).ksfReInstr || "";
  $("#reInstr").addEventListener("change", () => chrome.storage.local.set({ ksfReInstr: $("#reInstr").value }).catch(() => {}));
  $("#writeReport").addEventListener("click", writeReport);
  $("#resetReport").addEventListener("click", async () => {
    if (!report || !(await askConfirm("보고서 초안(제목·요약·대표 댓글)을 지울까요?"))) return;
    report = null;
    await chrome.storage.local.remove("ksfReport").catch(() => {});
    renderReportEdit();
  });
  for (const [id, key] of [["#rTitle", "title"], ["#rChannels", "channels"], ["#rHeadline", "headline"]]) {
    $(id).addEventListener("input", () => {
      report = { ...(report || {}), [key]: $(id).value };
      saveReportSoon();
      if (key === "headline") renderReportEdit();
    });
  }
  for (const [id, k] of [["#rSum1", 0], ["#rSum2", 1]]) {
    $(id).addEventListener("input", () => {
      const sum = [...(report?.summary || ["", ""])];
      sum[k] = $(id).value;
      report = { ...(report || {}), summary: sum };
      saveReportSoon();
    });
  }
  $("#dlPosts").addEventListener("click", () => (prepareFolder(), downloadNow(() => makePostsFile(false), "#postsMsg")));
  $("#dlPostsSenti").addEventListener("click", () => (prepareFolder(), downloadNow(() => makePostsFile(true), "#postsMsg")));
  $("#dlComments").addEventListener("click", () => (prepareFolder(), downloadNow(() => makeCommentsFile(false), "#commentsMsg")));
  $("#dlSentiment").addEventListener("click", () => (prepareFolder(), downloadNow(() => makeCommentsFile(true), "#sentimentMsg")));
  for (const id of ["purpose", "issueName"]) $(`#${id}`).addEventListener("input", () => renderWorkBar());
  $("#rInsights").addEventListener("input", () => {
    report = { ...(report || {}), insights: $("#rInsights").value.split("\n").map((x) => x.trim()).filter(Boolean) };
    saveReportSoon();
  });
  const saved = await chrome.storage.local.get(["ksfSummaryText", "ksfSummaryAt"]).catch(() => ({}));
  if (saved.ksfSummaryText) {
    $("#summaryText").value = saved.ksfSummaryText;
    $("#copySummary").disabled = false;
    $("#summaryInfo").textContent = `${new Date(saved.ksfSummaryAt).toLocaleString()}에 만든 SUMMARY`;
  }
  $("#summaryText").addEventListener("input", () => chrome.storage.local.set({ ksfSummaryText: $("#summaryText").value }).catch(() => {}));
  $("#copySummary").addEventListener("click", copySummary);
  $("#remakeSummary").addEventListener("click", () => refreshSummary("지금 숫자로"));
  $("#dlSummaryTxt").addEventListener("click", async () => {
    if (!$("#summaryText").value.trim()) await refreshSummary();
    prepareFolder();
    const where = await saveBytes(new Blob(["\ufeff" + $("#summaryText").value], { type: "text/plain;charset=utf-8" }), `${fileBase()}_SUMMARY.txt`);
    $("#summaryInfo").textContent = `✔ ${where}에 저장`;
  });
  renderTabs();
})();
