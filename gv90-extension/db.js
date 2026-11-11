// GV90 데일리 DB 화면: 보고일별 건수(전일 대비 ▲▼)·채널·성향(게시글·댓글·총평가), 그날 엑셀 저장·수정본 올리기·삭제,
// 기존 raw data 엑셀 등록, 기간 엑셀, 백업 받기·불러오기, 그날 게시물 보기

let openDay = null;
let fixDay = null;

function setInfo(text, cls = "") {
  $("#info").textContent = text;
  $("#info").className = `hint ${cls}`;
}

// 게시글 위치 주소 → 채널
function channelOfUrl(url) {
  const u = String(url || "");
  if (/youtube\.com|youtu\.be/.test(u)) return "유튜브";
  if (/cafe\.naver\.com|naver\.me/.test(u)) return "동호회";
  if (/bobaedream|clien\.net|ppomppu/.test(u)) return "자동차 커뮤니티";
  return "언론";
}

// 주소 → 비교 열쇠 (수집할 때의 key 와 같은 모양)
function keyOfUrl(url) {
  const u = String(url || "").trim();
  const n = newsIds(u);
  if (n) return `news:${n.oid}/${n.aid}`;
  const yt = parseYoutubeId(u);
  if (yt) return `yt:${yt}`;
  const cafe = u.match(/cafe\.naver\.com\/(?:f-e\/cafes\/(\d+)\/articles\/(\d+)|([A-Za-z0-9_-]+)\/(\d+))/);
  if (cafe) return cafe[1] ? `cafe:${cafe[1]}/${cafe[2]}` : `cafe:${cafe[3]}/${cafe[4]}`;
  const ad = communityAdapter(u);
  // 커뮤니티: 수집기와 같은 키 (사이트:글번호) — 주소 전체로 만들면 같은 글이 두 번 들어감
  if (ad) return `${ad.domain}:${ad.articleId(u) || u}`;
  return `newsx:${u.replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase()}`;
}

function diffSpan(d) {
  if (!d) return el("span", { class: "diff none", text: "" });
  return el("span", { class: `diff ${d.diff > 0 ? "up" : d.diff < 0 ? "down" : "none"}`, text: d.diff > 0 ? ` ▲ ${d.diff}` : d.diff < 0 ? ` ▼ ${-d.diff}` : " – 0" });
}

// 성향 건수 { 긍정, 중립, 부정, 단순비난, n }
function sentiOf(list) {
  const o = Object.fromEntries(SENTIMENTS.map((x) => [x, 0]));
  for (const x of list) if (x.sentiment && o[x.sentiment] != null) o[x.sentiment]++;
  o.n = SENTIMENTS.reduce((t, x) => t + o[x], 0);
  return o;
}

// 성향별 칸: 게시글 · 댓글 · 총평가(게시글+댓글) 세 줄로 나눠 보여 줌 (부정+단순비난 비율)
function sentiLines(ps, cs, wide = false) {
  const tot = Object.fromEntries([...SENTIMENTS, "n"].map((x) => [x, (ps[x] || 0) + (cs[x] || 0)]));
  const line = (label, o, cls) => {
    const bad = (o.부정 || 0) + (o.단순비난 || 0);
    return el("div", { class: `sline ${cls}` },
      el("span", { class: "slabel", text: label }),
      o.n ? el("span", {}, ...SENTIMENTS.filter((x) => o[x]).map((x) => el("span", { class: "sitem" }, sentiChip(x), el("span", { text: ` ${o[x].toLocaleString()}` })))) : el("span", { class: "hint", text: "-" }),
      o.n ? el("span", { class: `hint sbad${bad / o.n >= 0.3 ? " err" : ""}`, text: `부정+단순비난 ${Math.round((bad / o.n) * 100)}%` }) : null,
    );
  };
  return el("div", { class: `slines${wide ? " wide" : ""}` },
    line(`게시글 ${ps.n.toLocaleString()}`, ps, "sp"),
    line(`댓글 ${cs.n.toLocaleString()}`, cs, "sc"),
    line(`총평가 ${tot.n.toLocaleString()}`, tot, "st"),
  );
}

async function render() {
  const days = await listDays();
  const posts = await allPosts();
  const comments = await allComments();
  // 댓글은 원글의 보고일로 묶음 (댓글을 모은 날이 아니라 그 게시글이 보고된 날)
  const dayOfPost = new Map(posts.map((p) => [p.key, p.day]));
  const commentsByDay = new Map();
  for (const c of comments) {
    const k = dayOfPost.get(c.postKey) || c.day;
    if (!commentsByDay.has(k)) commentsByDay.set(k, []);
    commentsByDay.get(k).push(c);
  }
  const allP = sentiOf(posts);
  const allC = sentiOf(comments);
  $("#dbSummary").textContent = `보고일 ${days.length}일 · 누적 게시물 ${posts.length.toLocaleString()}건${comments.length ? ` · 댓글 ${comments.length.toLocaleString()}건` : ""}`;
  $("#dbSenti").replaceChildren(el("div", { class: "hint", text: "누적 성향" }), sentiLines(allP, allC, true));
  $("#dbSenti").hidden = !posts.length;
  const tb = $("#days tbody");
  tb.textContent = "";
  if (!days.length) tb.append(el("tr", {}, el("td", { colspan: 8, class: "empty", text: "아직 저장된 보고일이 없습니다. 수집 화면에서 '엑셀 만들기'를 누르거나 기존 raw data 엑셀을 등록하세요." })));
  days.forEach((d, i) => {
    const s = d.stats || {};
    const diff = dayDiff(days, i);
    const bad = (s.bySentiment?.부정 || 0) + (s.bySentiment?.단순비난 || 0);
    const cs = sentiOf(commentsByDay.get(d.day) || []);
    tb.append(
      el("tr", { "data-day": d.day },
        el("td", { class: "nowrap" }, el("b", { text: prettyDay(d.day) }), el("div", { class: "hint", text: dayOffReason(new Date(+d.day.slice(0, 4), +d.day.slice(4, 6) - 1, +d.day.slice(6, 8)), DEFAULT_SETTINGS) || "" })),
        el("td", { class: "hint nowrap", text: d.from ? `${fmtDateTime(d.from).slice(5)} ~ ${fmtDateTime(d.to).slice(5)}` : d.source || "-" }),
        el("td", { class: "nowrap" }, el("b", { text: `${(s.posts || 0).toLocaleString()}건` }), diffSpan(diff), el("div", { class: "hint", text: s.posts ? `부정+단순비난 ${Math.round((bad / s.posts) * 100)}%` : "" })),
        el("td", {}, ...CHANNELS.filter((c) => s.byChannel?.[c]).map((c) => el("span", {}, chChip(c), el("span", { text: `${s.byChannel[c]} ` })))),
        el("td", {}, sentiLines({ ...Object.fromEntries(SENTIMENTS.map((x) => [x, s.bySentiment?.[x] || 0])), n: SENTIMENTS.reduce((t, x) => t + (s.bySentiment?.[x] || 0), 0) }, cs)),
        el("td", { class: "nowrap", text: s.comments ? `${s.comments}건` : "-" }),
        el("td", { class: "hint", text: d.fileName || "-" }),
        el("td", { class: "acts" },
          el("button", { class: "small", text: "게시물 보기", onclick: () => showDay(d.day) }),
          el("button", { class: "small getbtn", text: "📥 엑셀 저장", onclick: (e) => downloadDay(d.day, e.currentTarget) }),
          el("button", { class: "small", text: "💬 댓글 엑셀 저장", title: "그날까지의 댓글 (누적 · 게시글 순서)", onclick: (e) => downloadDayComments(d.day, e.currentTarget) }),
          el("button", { class: "small", text: "수정본 올리기", title: "게시글 엑셀 · 댓글 엑셀 · 최종 엑셀 모두 올릴 수 있음 (고친 구분·주요 내용·성향 반영 · 댓글 포함)", onclick: () => { fixDay = d.day; $("#fixFile").value = ""; $("#fixFile").click(); } }),
          el("button", { class: "small danger", text: "삭제", onclick: () => removeDay(d.day) }),
        ),
      ),
    );
  });
  if (openDay) showDay(openDay);
}

// 그날 엑셀: 저장해 둔 파일 (없으면 그날까지 누적으로 새로 만듦)
async function downloadDay(day, btn) {
  if (!confirmResave(btn)) return;
  await prepareSaveDir();
  let f = await getDayFile(day);
  if (!f) {
    const posts = (await allPosts()).filter((p) => p.day <= day);
    const s = await loadSettings();
    f = { name: reportFileName(s, new Date(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8))), bytes: Gv90Xlsx.buildRaw({ posts, daily: (await listDays()).filter((d) => d.day <= day).reverse() }) };
  }
  const where = await saveFile(f.bytes, f.name);
  setInfo(`✔ ${where} 저장했습니다.`, "ok");
  markSaved(btn, "✔ 저장 완료!", where);
  celebrate(btn);
}

// 그날까지의 댓글 엑셀 (누적 · '엑셀에 담을 범위'가 '이번 보고분만'이면 그날 글의 댓글만)
async function downloadDayComments(day, btn) {
  if (!confirmResave(btn)) return;
  await prepareSaveDir();
  const s = await loadSettings();
  const posts = (await allPosts()).filter((p) => (s.xlsxScope === "today" ? p.day === day : p.day <= day));
  const keys = new Set(posts.map((p) => p.key));
  const comments = (await allComments()).filter((c) => keys.has(c.postKey));
  if (!comments.length) return setInfo(`${prettyDay(day)}: 저장할 댓글이 없습니다. 댓글 수집 화면에서 먼저 모아 주세요.`, "err");
  const name = reportFileName({ ...s, fileName: String(s.fileName || "").replace(/\s*게시글\s*/g, " ").replace(/raw data/i, "").replace(/\s+/g, " ").trim() + " 댓글 raw data" }, new Date(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8)));
  const where = await saveFile(Gv90Xlsx.buildComments({ comments, posts }), name);
  setInfo(`✔ 댓글 ${comments.length.toLocaleString()}개를 ${where} 저장했습니다.`, "ok");
  markSaved(btn, "✔ 저장 완료!", where);
  celebrate(btn);
}

async function removeDay(day) {
  const n = (await postsOfDay(day)).length;
  if (!confirm(`${prettyDay(day)} 보고분(게시물 ${n}건)을 데일리 DB 에서 지울까요?\n(다른 날짜의 게시물은 그대로입니다. 되돌릴 수 없으니 먼저 백업을 받아 두세요)`)) return;
  await deleteDay(day);
  if (openDay === day) openDay = null;
  $("#dayBox").hidden = !openDay;
  setInfo(`${prettyDay(day)} 보고분을 지웠습니다.`);
  render().then(renderFinal);
}

async function showDay(day) {
  openDay = day;
  const posts = await postsOfDay(day);
  $("#dayBox").hidden = false;
  $("#dayTitle").textContent = `${prettyDay(day)} 보고 게시물 ${posts.length}건`;
  const q = compactLower($("#dayFilter").value);
  const sf = $("#daySenti").value;
  const tb = $("#dayPosts tbody");
  tb.textContent = "";
  for (const p of posts) {
    if (sf && p.sentiment !== sf) continue;
    if (q && !compactLower(`${p.media} ${p.title} ${p.summary}`).includes(q)) continue;
    tb.append(
      el("tr", {},
        el("td", { text: p.serial }),
        el("td", {}, chChip(p.channel)),
        el("td", { class: "nowrap", text: p.media }),
        el("td", { class: "nowrap", text: p.date ? fmtDateTime(p.date).slice(5, 10) : "-" }),
        el("td", { text: p.category || "" }),
        el("td", { class: "url" }, countsBadge(p), el("a", { href: p.url, target: "_blank", text: p.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48) })),
        el("td", { text: p.summary || p.title }),
        el("td", {}, sentiChip(p.sentiment)),
        el("td", {}, el("button", { class: "small danger", text: "✕", title: "이 게시물을 DB 에서 지우기", onclick: async () => {
          if (!confirm(`'${(p.summary || p.title).slice(0, 40)}' 게시물을 DB 에서 지울까요?`)) return;
          await deletePosts([p.key]);
          await refreshDay(day);
          render().then(renderFinal);
        } })),
      ),
    );
  }
}

// 엑셀 행 → DB 게시물 (raw data 등록·수정본 올리기 공통)
function rowToPost(r, day) {
  return {
    key: keyOfUrl(r.url),
    url: r.url,
    channel: channelOfUrl(r.url),
    media: r.community,
    car: r.car || "GV90",
    date: r.date ? r.date.getTime() : null,
    exact: false,
    title: "",
    summary: r.summary,
    category: r.category || "일반",
    sentiment: SENTIMENTS.includes(r.sentiment) ? r.sentiment : "",
    by: "upload",
    day,
  };
}

// 기존 raw data 엑셀 등록: GV90 행만(차종 GV90·JG… 또는 이 프로그램 양식) · 보고일은 게시일 다음 날로 가늠 · 성향이 비면 단어 사전으로
$("#importRaw").addEventListener("click", () => {
  $("#rawFile").value = "";
  $("#rawFile").click();
});
$("#rawFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  setInfo(`${f.name} 읽는 중…`);
  try {
    const rows = (await Gv90Xlsx.read(new Uint8Array(await f.arrayBuffer()))).filter((r) => !r.isComment && r.url && /GV90|^JG/i.test(r.car));
    if (!rows.length) return setInfo("GV90(JG) 차종 행을 찾지 못했습니다. (머리글: 커뮤니티명·차종·게시일·구분·게시글 위치·주요 내용)", "err");
    rows.sort((a, b) => (a.serial ?? 0) - (b.serial ?? 0) || (a.date || 0) - (b.date || 0));
    const byDay = new Map();
    for (const r of rows) {
      const d = r.date ? new Date(r.date.getFullYear(), r.date.getMonth(), r.date.getDate() + 1) : new Date();
      const day = todayKey(d);
      const p = rowToPost(r, day);
      if (!p.sentiment) Object.assign(p, { sentiment: ruleSentiment(p.summary) });
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(p);
    }
    let added = 0;
    for (const [day, list] of [...byDay.entries()].sort()) {
      added += (await savePosts(list, day)).added;
      await refreshDay(day, { source: `등록: ${f.name}` });
    }
    setInfo(`✔ ${f.name}: GV90 행 ${rows.length}건 중 새 게시물 ${added}건을 ${byDay.size}개 보고일로 등록했습니다.`, "ok");
    celebrate(null);
    render().then(renderFinal);
  } catch (err) {
    setInfo(`등록하지 못했습니다: ${err.message}`, "err");
  }
});

// 수정본 올리기: 같은 URL 의 커뮤니티명·구분·주요 내용·성향을 바꾸고, 그날 엑셀을 이 파일로 바꿈
// 엑셀에서 고친 댓글의 구분·성향을 DB 에 반영 (같은 게시글 주소 + 같은 댓글 내용)
async function applyCommentFixes(rows) {
  if (!rows.length) return { seen: 0, changed: 0, missed: 0 };
  const norm = (t) => String(t || "").replace(/^\s*(?:↳|↪\s*답글:)\s*/, "").replace(/\s+/g, " ").trim();
  const nurl = (u) => String(u || "").replace(/^https?:\/\/(www\.|m\.)?/, "").replace(/\/$/, "");
  // 느슨한 비교: 띄어쓰기·보이지 않는 글자·따옴표 모양·끝의 '…' 차이는 무시 (엑셀이 바꾸는 경우)
  const loose = (t) => norm(t).normalize("NFC").replace(/[\s\u200b-\u200d\ufeff]/g, "").replace(/[“”″]/g, '"').replace(/[‘’′]/g, "'").replace(/…$/, "");
  const all = await allComments();
  const byKey = new Map();
  const byText = new Map();
  for (const c of all) {
    byKey.set(`${nurl(c.url)}|${norm(c.text)}`, c);
    byKey.set(`${c.postKey}|${norm(c.text)}`, c);
    byKey.set(`${nurl(c.url)}|~${loose(c.text)}`, c);
    const lt = loose(c.text);
    byText.set(lt, byText.has(lt) ? null : c); // 내용만으로 찾기는 하나뿐일 때만
  }
  const changed = [];
  const missedText = [];
  let missed = 0;
  for (const r of rows) {
    const c =
      byKey.get(`${nurl(r.url)}|${norm(r.summary)}`) ||
      byKey.get(`${keyOfUrl(r.url)}|${norm(r.summary)}`) ||
      byKey.get(`${nurl(r.url)}|~${loose(r.summary)}`) ||
      byText.get(loose(r.summary));
    if (!c) {
      missed++;
      if (missedText.length < 3) missedText.push(norm(r.summary).slice(0, 30));
      continue;
    }
    const patch = {};
    if (SENTIMENTS.includes(r.sentiment) && r.sentiment !== c.sentiment) patch.sentiment = r.sentiment;
    if (r.category && r.category !== c.category) patch.category = r.category;
    if (!Object.keys(patch).length) continue;
    const edited = [...new Set([...(c.edited || []), ...Object.keys(patch)])];
    changed.push({ ...c, ...patch, edited, by: patch.sentiment ? "edit" : c.by, catOwn: true });
  }
  if (changed.length) await putComments(changed);
  return { seen: rows.length, changed: changed.length, missed, missedText };
}

$("#fixFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f || !fixDay) return;
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const all = await Gv90Xlsx.read(bytes);
    const rows = all.filter((r) => !r.isComment && r.url);
    // 댓글 줄(댓글 엑셀 '댓글' 시트 · 최종 엑셀 '게시글 댓글 성향' 탭): 같은 글의 같은 댓글을 찾아 구분·성향 반영
    const cfix = await applyCommentFixes(all.filter((r) => r.isComment && r.url && r.summary));
    const posts = new Map((await allPosts()).map((p) => [p.key, p]));
    let changed = 0;
    let added = 0;
    const fresh = [];
    for (const r of rows) {
      const key = keyOfUrl(r.url);
      const old = posts.get(key);
      if (old) {
        const patch = { media: r.community || old.media, category: r.category || old.category, summary: r.summary || old.summary, sentiment: SENTIMENTS.includes(r.sentiment) ? r.sentiment : old.sentiment, car: r.car || old.car };
        // 게시일을 날짜로 고쳤으면 반영 (시각은 그대로)
        if (r.date && old.date && todayKey(r.date) !== todayKey(new Date(old.date))) {
          const o = new Date(old.date);
          patch.date = new Date(r.date.getFullYear(), r.date.getMonth(), r.date.getDate(), o.getHours(), o.getMinutes()).getTime();
        }
        if (Object.keys(patch).some((k) => patch[k] !== old[k])) {
          await updatePost(key, { ...patch, by: "edit" });
          changed++;
        }
      } else if (r.date && todayKey(r.date) <= fixDay) {
        fresh.push(rowToPost(r, fixDay));
      }
    }
    if (fresh.length) added = (await savePosts(fresh, fixDay)).added;
    await saveDayFile(fixDay, f.name.replace(/\s*\(\d+\)(?=\.xlsx$)/i, ""), bytes);
    for (const d of await listDays()) await refreshDay(d.day);
    setInfo(`✔ ${prettyDay(fixDay)} 수정본: 바뀐 게시물 ${changed}건 · 새로 넣은 게시물 ${added}건${cfix.seen ? ` · 바뀐 댓글 ${cfix.changed}개${cfix.missed ? ` (DB 에서 못 찾은 댓글 ${cfix.missed}개: "${cfix.missedText.join('", "')}"…)` : ""}` : " · 댓글 줄 없음(게시글만 반영)"} · 그날 엑셀을 이 파일로 바꿨습니다.`, "ok");
    celebrate(null);
    render().then(renderFinal);
  } catch (err) {
    setInfo(`수정본을 올리지 못했습니다: ${err.message}`, "err");
  }
});

// 기간 엑셀 (보고일 기준)
for (const id of ["rangeFrom", "rangeTo"]) $(`#${id}`).addEventListener("change", () => resetSaveButton($("#rangeXlsx"), "📥 기간 엑셀 저장"));
$("#rangeXlsx").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  if (!confirmResave(btn)) return;
  await prepareSaveDir();
  const from = ($("#rangeFrom").value || "0000-00-00").replace(/-/g, "");
  const to = ($("#rangeTo").value || "9999-99-99").replace(/-/g, "");
  const posts = (await allPosts()).filter((p) => p.day >= from && p.day <= to);
  if (!posts.length) return setInfo("그 기간에 보고된 게시물이 없습니다.", "err");
  const daily = (await listDays()).filter((d) => d.day >= from && d.day <= to).reverse();
  const bytes = Gv90Xlsx.buildRaw({ posts, daily });
  const where = await saveFile(bytes, `${from.slice(2)}-${to.slice(2)}_GV90 온라인 동향 게시글 raw data (기간).xlsx`);
  setInfo(`✔ ${posts.length}건을 ${where} 저장했습니다.`, "ok");
  markSaved(btn, "✔ 기간 엑셀 저장 완료!", where);
  celebrate(btn);
});

$("#exportBackup").addEventListener("click", async (e) => {
  const data = await exportBackup();
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  await downloadBytes(bytes, `${todayKey()}_GV90 데일리 DB 백업.json`);
  setInfo(`✔ 백업을 받았습니다 (게시물 ${data.posts.length}건 · 보고일 ${data.days.length}일). API 키는 들어가지 않습니다.`, "ok");
  celebrate(e.target);
});
$("#importBackup").addEventListener("click", () => {
  $("#backupFile").value = "";
  $("#backupFile").click();
});
$("#backupFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const r = await importBackup(JSON.parse(await f.text()));
    setInfo(`✔ 백업을 불러왔습니다: 게시물 ${r.posts}건 · 댓글 ${r.comments}건 · 보고일 ${r.days}일`, "ok");
    render().then(renderFinal);
  } catch (err) {
    setInfo(`백업을 불러오지 못했습니다: ${err.message}`, "err");
  }
});
$("#dayFilter").addEventListener("input", () => openDay && showDay(openDay));
$("#daySenti").addEventListener("change", () => openDay && showDay(openDay));

// ---------------------------------------------------------------------------
// 최종 엑셀: 최근 보고일 — 게시글 · 게시글 댓글 성향 · 일자별 집계 (댓글 수집까지 끝나면 버튼이 반짝임)
// ---------------------------------------------------------------------------

const commentable = (p) => p.channel !== "언론" || /news\.naver\.com/.test(p.url || "");

async function renderFinal() {
  const days = await listDays();
  const box = $("#finalBox");
  box.hidden = !days.length;
  if (!days.length) return;
  const day = days[0].day;
  const posts = await postsOfDay(day);
  const targets = posts.filter(commentable);
  const done = targets.filter((p) => p.commentStatus);
  const keys = new Set(posts.map((p) => p.key));
  const nComments = (await allComments()).filter((c) => keys.has(c.postKey)).length;
  const complete = targets.length > 0 && done.length === targets.length;
  $("#finalDay").textContent = `(${prettyDay(day)} 보고분)`;
  $("#finalStatus").innerHTML = complete
    ? `✅ <b>댓글 수집 완료</b> — 게시글 ${posts.length}건 · 댓글 ${nComments.toLocaleString()}개. 최종 엑셀을 받으세요.`
    : `⏳ 댓글 수집 ${done.length}/${targets.length} 게시글 — 댓글 수집 화면에서 마저 수집하면 버튼이 반짝입니다 (지금 받아도 됩니다).`;
  const btn = $("#finalXlsx");
  if (!btn.dataset.saved) readyButton(btn, complete);
  box.classList.toggle("done", complete);
  box.dataset.day = day;
}

$("#finalXlsx").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  if (!confirmResave(btn)) return;
  await prepareSaveDir();
  const day = $("#finalBox").dataset.day;
  const s = await loadSettings();
  const posts = s.xlsxScope === "today" ? await postsOfDay(day) : (await allPosts()).filter((p) => p.day <= day);
  // 댓글도 게시글과 같은 범위 (기본 누적)
  const postKeys = new Set(posts.map((p) => p.key));
  const comments = (await allComments()).filter((c) => postKeys.has(c.postKey));
  const daily = (await listDays()).filter((d) => d.day <= day).reverse();
  const bytes = Gv90Xlsx.buildFinal({ posts, comments, daily });
  const name = reportFileName({ ...s, fileName: String(s.fileName || "").replace(/\s*게시글\s*/g, " ").replace(/raw data/i, "").replace(/\s+/g, " ").trim() + " 최종" }, new Date(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8)));
  const where = await saveFile(bytes, name);
  setInfo(`✔ 최종 엑셀(게시글 ${posts.length}건 · 댓글 ${comments.length}개)을 ${where} 저장했습니다.`, "ok");
  markSaved(btn, "✔ 최종 엑셀 저장 완료!", where);
  celebrate(btn);
});

$("#finalFix").addEventListener("click", () => {
  fixDay = $("#finalBox").dataset.day;
  if (!fixDay) return;
  $("#fixFile").value = "";
  $("#fixFile").click();
});

// 예전 수정본 올리기로 같은 커뮤니티 글이 두 번 들어간 것 정리: 올린 쪽(by: upload)의 고친 값을 원래 글에 옮기고 지움
async function mergeUploadDuplicates() {
  const posts = await allPosts();
  const byKey = new Map(posts.map((p) => [p.key, p]));
  const drop = [];
  for (const p of posts) {
    if (p.by !== "upload" || !p.url) continue;
    const k = keyOfUrl(p.url);
    const orig = k !== p.key ? byKey.get(k) : null;
    if (!orig) continue;
    await updatePost(orig.key, { media: p.media || orig.media, summary: p.summary || orig.summary, category: p.category || orig.category, sentiment: p.sentiment || orig.sentiment, by: "edit" });
    drop.push(p.key);
  }
  if (!drop.length) return 0;
  await deletePosts(drop);
  for (const d of await listDays()) await refreshDay(d.day);
  return drop.length;
}

const dbInit = mergeUploadDuplicates()
  .then((n) => {
    if (n) setInfo(`✔ 수정본 올리기로 두 번 들어갔던 게시물 ${n}건을 하나로 합쳤습니다 (고친 값은 원래 글에 반영).`, "ok");
  })
  .catch(() => {})
  .then(render)
  .then(renderFinal);
