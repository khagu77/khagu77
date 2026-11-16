// 화면: 대시보드 · 수집 · DB · 설정
const $ = (s) => document.querySelector(s);
let settings = null;
let videos = []; // DB 전체 (화면 캐시)
let running = false;
let stopFlag = false;

const todayYmd = () => ymd(new Date());
const periodOf = () => ({ start: settings.start || DEFAULTS.start, end: settings.end || todayYmd() });

// ---------------------------------------------------------------------------
// 탭
// ---------------------------------------------------------------------------
function showTab() {
  const t = (location.hash || "#dash").slice(1);
  const tab = ["dash", "collect", "db", "settings"].includes(t) ? t : "dash";
  document.querySelectorAll(".tab").forEach((el) => el.classList.toggle("on", el.id === `tab-${tab}`));
  document.querySelectorAll("nav.menu a").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));
  if (tab === "dash") renderDash();
  if (tab === "db") renderDb();
}
window.addEventListener("hashchange", showTab);

async function reloadVideos() {
  videos = await DB.all();
  const p = periodOf();
  const inc = computeStats(videos, p).total;
  $("#dbCount").textContent = `${inc}/${videos.length}`;
}

function heroSub() {
  const p = periodOf();
  $("#heroSub").textContent = `기간 ${p.start.replace(/-/g, ".")} ~ ${settings.end ? p.end.replace(/-/g, ".") : `${p.end.replace(/-/g, ".")} (현재)`} · 관리 채널 + 주요 경제 채널 + 해당 주제 콘텐츠를 만드는 모든 채널`;
  $("#periodInfo").textContent = `수집 기간: ${p.start} ~ ${p.end} (설정에서 바꿈)`;
}

// ---------------------------------------------------------------------------
// 대시보드
// ---------------------------------------------------------------------------
let dashStats = null;
function dashFilter() {
  const p = periodOf();
  return { start: $("#dStart").value || p.start, end: $("#dEnd").value || p.end, group: $("#dGroup").value };
}

async function channelCount() {
  const { hmChannels } = await chrome.storage.local.get("hmChannels");
  return Object.values(hmChannels || {}).filter((c) => c.group === "managed" || c.group === "econ").length;
}

async function renderDash() {
  const f = dashFilter();
  dashStats = computeStats(videos, f);
  const cc = await channelCount();
  $("#dashBody").innerHTML = dashHtml(dashStats, { fluid: true, banner: chrome.runtime.getURL("icons/banner.jpg"), chartInteractive: true, channelCount: cc });
  if (!videos.length) $("#dashInfo").innerHTML = "아직 DB 가 비어 있습니다. <b>🔎 수집</b> 탭에서 <b>수집 시작</b>을 누르세요.";
  else if ($("#dashInfo").dataset.keep !== "1") $("#dashInfo").textContent = "";
  hookChartTip();
}
["#dStart", "#dEnd", "#dGroup"].forEach((s) => $(s).addEventListener("change", () => renderDash()));

// 그래프에 마우스를 올리면 그날 수치
function hookChartTip() {
  const svg = $("#dashBody svg");
  const tip = $("#tip");
  if (!svg || !dashStats) return;
  const cross = svg.querySelector(".cross");
  svg.querySelectorAll(".hit").forEach((r) => {
    r.addEventListener("mousemove", (e) => {
      const d = dashStats.days[+r.dataset.i];
      const x = +r.getAttribute("x") + +r.getAttribute("width") / 2;
      cross.setAttribute("x1", x);
      cross.setAttribute("x2", x);
      cross.setAttribute("visibility", "visible");
      tip.innerHTML = `<b>${ymd(d.date)} (${WD[d.date.getDay()]})</b><br>발행 <b>${d.count}</b>건 · 7일 평균 ${d.ma7 == null ? "-" : d.ma7.toFixed(1)}건<br>누적 ${d.cum}건 · 관리 ${d.managed} · 경제 ${d.econ} · 기타 ${d.other}`;
      tip.hidden = false;
      tip.style.left = `${Math.min(e.clientX + 14, innerWidth - 240)}px`;
      tip.style.top = `${e.clientY + 14}px`;
    });
    r.addEventListener("mouseleave", () => {
      tip.hidden = true;
      cross.setAttribute("visibility", "hidden");
    });
  });
}

function dashMsg(text, ok = true) {
  const el = $("#dashInfo");
  el.textContent = text;
  el.className = ok ? "hint ok" : "hint err";
  el.dataset.keep = "1";
  setTimeout(() => (el.dataset.keep = ""), 8000);
}

// 메일 붙여 넣기: 표 + 인라인 서식 HTML 을 복사 (그림은 인터넷 주소라 메일에서도 보임)
function copyHtml(html, text, okMsg) {
  let done = false;
  const onCopy = (e) => {
    e.clipboardData.setData("text/html", html);
    e.clipboardData.setData("text/plain", text);
    e.preventDefault();
    done = true;
  };
  document.addEventListener("copy", onCopy);
  try {
    document.execCommand("copy");
  } catch {}
  document.removeEventListener("copy", onCopy);
  if (done) return dashMsg(okMsg);
  navigator.clipboard
    .write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })])
    .then(() => dashMsg(okMsg))
    .catch((e) => dashMsg(`복사하지 못했습니다: ${e.message}`, false));
}

async function mailHtml(withImages) {
  const cc = await channelCount();
  let body = dashHtml(dashStats, { fluid: false, banner: withImages ? BANNER_URL : "", channelCount: cc });
  if (!withImages) body = body.replace(/<td style="padding:4px 8px 4px 0;width:80px;vertical-align:top;"><a [^>]*><img [^>]*><\/a><\/td>/g, "");
  return body;
}

$("#copyMail").addEventListener("click", async () => {
  if (!dashStats) return;
  const body = await mailHtml(true);
  copyHtml(`<html><body>${body}</body></html>`, dashText(dashStats), "✔ 복사했습니다. 메일 본문에 붙여 넣으세요 (Ctrl+V / ⌘V). 그림이 안 들어가면 '이미지 없이 복사'를 눌러 보세요.");
});
$("#copyLite").addEventListener("click", async () => {
  if (!dashStats) return;
  const body = await mailHtml(false);
  copyHtml(`<html><body>${body}</body></html>`, dashText(dashStats), "✔ 이미지 없이 복사했습니다. 메일 본문에 붙여 넣으세요.");
});
$("#copyCode").addEventListener("click", async () => {
  if (!dashStats) return;
  const code = await mailHtml(true);
  try {
    await navigator.clipboard.writeText(code);
    dashMsg("✔ HTML 코드를 복사했습니다. 메일 편집기의 'HTML' 탭에 붙여 넣은 뒤 '디자인' 탭으로 돌아오면 대시보드가 보입니다.");
  } catch (e) {
    dashMsg(`복사하지 못했습니다: ${e.message}`, false);
  }
});

// ---------------------------------------------------------------------------
// 엑셀 받기
// ---------------------------------------------------------------------------
async function downloadExcel(st, label, infoEl) {
  if (!st.list.length) {
    infoEl.textContent = "엑셀에 넣을 콘텐츠가 없습니다.";
    infoEl.className = "hint err";
    return;
  }
  infoEl.className = "hint";
  infoEl.textContent = "썸네일을 받는 중…";
  const bytes = await buildExcel(st, { onProgress: (i, n) => (infoEl.textContent = `썸네일 넣는 중… ${i}/${n}`) });
  const d = new Date();
  const name = `${String(d.getFullYear()).slice(2)}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_현대차 위기론 유튜브 모니터링${label ? `_${label}` : ""}.xlsx`;
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  try {
    await chrome.downloads.download({ url, filename: name, saveAs: false });
  } catch {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  infoEl.textContent = `✔ ${name} (${st.list.length}건) 을 받았습니다.`;
  infoEl.className = "hint ok";
  if (infoEl.id === "dashInfo") infoEl.dataset.keep = "1";
}
$("#xlsxDash").addEventListener("click", () => downloadExcel(computeStats(videos, dashFilter()), "", $("#dashInfo")));

// ---------------------------------------------------------------------------
// 수집
// ---------------------------------------------------------------------------
function log(s) {
  const el = $("#log");
  el.textContent += `${new Date().toTimeString().slice(0, 8)}  ${s}\n`;
  el.scrollTop = el.scrollHeight;
}
function stage(s, pct) {
  $("#stage").textContent = s;
  if (pct != null) $("#bar").style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

// 채널 목록: [{ name, base, group, video? }]
function channelLines(text, group) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const l = line.trim();
    if (!l) continue;
    const [a, b] = l.includes("|") ? l.split("|").map((x) => x.trim()) : ["", l];
    const base = YT.channelBase(b);
    const vid = !base ? YT.videoId(b) : null;
    if (base || vid) out.push({ name: a, base, video: vid, group });
  }
  return out;
}

// 영상 주소로 넣은 관리 채널 → 그 영상의 채널 (한 번 알아내면 저장)
async function resolveChannels() {
  const { hmResolved = {} } = await chrome.storage.local.get("hmResolved");
  const list = [...channelLines(settings.managed, "managed"), ...channelLines(settings.econ, "econ")];
  for (const c of list) {
    if (c.base || !c.video) continue;
    if (!hmResolved[c.video]) {
      try {
        const v = await YT.video(c.video);
        hmResolved[c.video] = { id: v.channelId, name: v.channelName, url: v.channelUrl };
        log(`관리 채널 확인: ${c.video} → ${v.channelName}`);
      } catch (e) {
        log(`⚠ 관리 채널 영상 ${c.video} 을 열 수 없음 (${e.message}) — 건너뜀`);
        continue;
      } finally {
        await YT.jitter(400, 900);
      }
    }
    const r = hmResolved[c.video];
    c.base = YT.channelBase(r.url) || (r.id ? `https://www.youtube.com/channel/${r.id}` : null);
    c.name = c.name || r.name;
    c.id = r.id;
  }
  await chrome.storage.local.set({ hmResolved });
  // 같은 채널은 한 번만 (관리 채널 우선)
  const seen = new Set();
  return list.filter((c) => {
    if (!c.base) return false;
    const k = c.id || c.base.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function inRangeApprox(it, start, endNext) {
  const a = YT.parseAgo(it.agoText);
  if (!a) return true; // 날짜를 모르면 영상 화면에서 확인
  return a.date.getTime() + a.slack >= start.getTime() && a.date.getTime() - 86400000 <= endNext.getTime();
}

async function runCollect() {
  if (running) return;
  running = true;
  stopFlag = false;
  $("#run").disabled = true;
  $("#stop").disabled = false;
  $("#aiOnly").disabled = true;
  $("#log").textContent = "";
  const t0 = Date.now();
  const p = periodOf();
  const start = parseYmd(p.start);
  const end = parseYmd(p.end);
  const endNext = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  const opt = { channels: $("#optChannels").checked, search: $("#optSearch").checked, refresh: $("#optRefresh").checked, ai: $("#optAi").checked };
  const cands = new Map(); // id → 목록에서 본 정보
  const addCand = (it, src) => {
    const c = cands.get(it.id);
    if (c) {
      if (!c.sources.includes(src)) c.sources.push(src);
      for (const k of ["channelId", "channelName", "snippet", "agoText"]) if (!c[k] && it[k]) c[k] = it[k];
    } else cands.set(it.id, { ...it, sources: [src] });
  };
  const topicCheck = (it) => classify({ title: it.title, desc: it.snippet || "" }, settings).topic;
  const { hmChannels = {} } = await chrome.storage.local.get("hmChannels");
  let errors = 0;
  try {
    log(`수집 기간 ${p.start} ~ ${p.end}`);
    // 1) 관리·경제 채널
    const chans = await resolveChannels();
    const groupById = new Map();
    for (const c of chans) if (c.id) groupById.set(c.id, c.group);
    if (opt.channels) {
      const qs = splitList(settings.channelQueries);
      for (let i = 0; i < chans.length && !stopFlag; i++) {
        const c = chans[i];
        stage(`① 채널 훑기 ${i + 1}/${chans.length} · ${c.name || c.base}`, (i / chans.length) * 30);
        let found = 0;
        for (const q of [...qs, null]) {
          if (stopFlag) break;
          try {
            const r = q ? await YT.channelSearch(c.base, q) : await YT.channelLatest(c.base);
            if (r.channel?.id) {
              c.id = r.channel.id;
              c.name = c.name || r.channel.name;
              groupById.set(r.channel.id, c.group);
              hmChannels[c.base] = { id: r.channel.id, name: r.channel.name || c.name, url: r.channel.url || c.base, group: c.group };
            }
            for (const it of r.items) {
              if (it.channelId && c.id && it.channelId !== c.id) continue; // 채널 검색 결과에 섞인 다른 채널
              if (!inRangeApprox(it, start, endNext) || !topicCheck(it)) continue;
              it.channelId = it.channelId || c.id;
              it.channelName = it.channelName || c.name;
              addCand(it, q ? `채널검색:${q}` : "채널최신");
              found++;
            }
          } catch (e) {
            errors++;
            log(`⚠ ${c.name || c.base} ${q ? `'${q}' 검색` : "최신 영상"} 실패: ${e.message}`);
          }
          await YT.jitter(500, 1100);
        }
        log(`${GROUPS[c.group]} · ${c.name || c.base}: 관련 영상 ${found}개`);
      }
      await chrome.storage.local.set({ hmChannels });
    }
    // 2) 유튜브 전체 검색
    if (opt.search && !stopFlag) {
      const qs = splitList(settings.queries.replace(/,/g, "\n"));
      for (let i = 0; i < qs.length && !stopFlag; i++) {
        stage(`② 유튜브 검색 ${i + 1}/${qs.length} · '${qs[i]}'`, 30 + (i / qs.length) * 20);
        let found = 0;
        try {
          await YT.search(qs[i], {
            since: start,
            pages: +settings.searchPages || 6,
            stopped: () => stopFlag,
            onPage: (items) => {
              for (const it of items) {
                if (!inRangeApprox(it, start, endNext) || !topicCheck(it)) continue;
                addCand(it, `검색:${qs[i]}`);
                found++;
              }
            },
          });
        } catch (e) {
          errors++;
          log(`⚠ '${qs[i]}' 검색 실패: ${e.message}`);
        }
        log(`검색 '${qs[i]}': 관련 영상 ${found}개 (누적 후보 ${cands.size}개)`);
        await YT.jitter(600, 1300);
      }
    }
    // 3) 영상 정보 (새 영상 + 새로 고침)
    const existing = new Map(videos.map((v) => [v.id, v]));
    const todo = [...cands.keys()];
    if (opt.refresh)
      for (const v of videos) {
        if (cands.has(v.id) || v.gone) continue;
        const t = v.published ? new Date(v.published).getTime() : 0;
        if (t >= start.getTime() && t < endNext.getTime()) todo.push(v.id);
      }
    const fresh = (v) => v?.updated && Date.now() - new Date(v.updated).getTime() < 3 * 3600000;
    const work = todo.filter((id) => !(existing.has(id) && fresh(existing.get(id)) && !opt.refresh));
    log(`영상 정보 읽기: ${work.length}개 (후보 ${cands.size}개 · DB ${videos.length}개)`);
    let done = 0;
    let added = 0;
    let updated = 0;
    let outRange = 0;
    const today = todayYmd();
    const worker = async () => {
      while (work.length && !stopFlag) {
        const id = work.shift();
        const prev = existing.get(id);
        const cand = cands.get(id) || {};
        try {
          const d = await YT.video(id);
          const t = d.published ? d.published.getTime() : null;
          if (t != null && (t < start.getTime() || t >= endNext.getTime())) {
            outRange++;
            if (!prev) continue;
          }
          const rec = {
            ...(prev || { firstSeen: new Date().toISOString(), history: {} }),
            id,
            url: `https://www.youtube.com/watch?v=${id}`,
            title: d.title,
            channelName: d.channelName || cand.channelName || prev?.channelName || "",
            channelId: d.channelId || cand.channelId || prev?.channelId || "",
            channelUrl: d.channelUrl || prev?.channelUrl || "",
            published: d.published ? d.published.toISOString() : prev?.published || null,
            hasTime: d.hasTime,
            views: d.views,
            likes: d.likes,
            comments: d.comments,
            desc: d.desc,
            snippet: cand.snippet || prev?.snippet || "",
            lengthSec: d.lengthSec,
            isShort: cand.isShort || prev?.isShort || false,
            sources: [...new Set([...(prev?.sources || []), ...(cand.sources || [])])],
            updated: new Date().toISOString(),
            gone: false,
          };
          rec.history = { ...(rec.history || {}), [today]: { views: d.views, likes: d.likes, comments: d.comments } };
          rec.group = groupById.get(rec.channelId) || "other";
          Object.assign(rec, classify(rec, settings));
          if (!rec.topic && !prev && !rec.manual) continue; // 설명까지 봐도 현대차와 무관
          if (!rec.summary || rec.summarySrc === "rule") {
            rec.summary = ruleSummary(rec);
            rec.summarySrc = "rule";
          }
          rec.include = decideInclude(rec);
          await DB.put(rec);
          existing.set(id, rec);
          prev ? updated++ : added++;
        } catch (e) {
          if (e.gone && prev) {
            prev.gone = true;
            prev.updated = new Date().toISOString();
            await DB.put(prev);
            log(`⚠ 삭제·비공개: ${prev.title}`);
          } else {
            errors++;
            log(`⚠ 영상 ${id} 읽기 실패: ${e.message}`);
          }
        } finally {
          done++;
          const n = done + work.length;
          stage(`③ 영상 정보 ${done}/${n}`, 50 + (done / Math.max(1, n)) * 35);
          await YT.jitter(300, 800);
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    log(`새로 추가 ${added}개 · 갱신 ${updated}개 · 기간 밖 ${outRange}개`);
    await reloadVideos();
    // 4) AI
    if (opt.ai && !stopFlag) await runAi(false);
    const st = computeStats(videos, periodOf());
    const msg = `${stopFlag ? "중지됨" : "완료"} · 부정 프레임 ${st.total}건 (DB ${videos.length}개) · ${Math.round((Date.now() - t0) / 60000)}분${errors ? ` · 오류 ${errors}건` : ""}`;
    stage(`✔ ${msg}`, 100);
    log(msg);
    await DB.put({ at: new Date().toISOString(), added, updated, total: st.total, db: videos.length, errors, stopped: stopFlag }, "runs");
    await chrome.storage.local.set({ hmLastRun: { at: new Date().toISOString(), msg } });
    showLastRun();
    if (settings.sound) ding();
  } catch (e) {
    stage(`오류: ${e.message}`);
    log(`오류: ${e.stack || e.message}`);
  } finally {
    running = false;
    $("#run").disabled = false;
    $("#stop").disabled = true;
    $("#aiOnly").disabled = false;
    await reloadVideos();
  }
}

// AI 요약·판단 (아직 AI 판단이 없는 영상, all=true 면 기간 안 전부 다시)
async function runAi(all) {
  const { hmAiKey } = await chrome.storage.local.get("hmAiKey");
  if (!hmAiKey || !settings.ai.on) {
    log("AI: API 키가 없거나 꺼져 있어 단어 판단·설명 요약으로 둡니다.");
    return;
  }
  const p = periodOf();
  const s = parseYmd(p.start).getTime();
  const e = parseYmd(p.end).getTime() + 86400000;
  const targets = videos.filter((v) => {
    const t = v.published ? new Date(v.published).getTime() : 0;
    return t >= s && t < e && (all || !v.ai) && (v.topic || v.manual);
  });
  if (!targets.length) return log("AI: 새로 판단할 영상이 없습니다.");
  const model = settings.ai.model;
  log(`AI: ${targets.length}개 판단 (${model})`);
  let input = 0;
  let output = 0;
  let doneN = 0;
  const batches = [];
  for (let i = 0; i < targets.length; i += 10) batches.push(targets.slice(i, i + 10));
  const worker = async () => {
    while (batches.length && !stopFlag) {
      const b = batches.shift();
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await aiBatch(hmAiKey, model, b);
          input += r.input;
          output += r.output;
          const byId = new Map(r.items.map((x) => [x.id, x]));
          for (const v of b) {
            const a = byId.get(v.id);
            if (!a) continue;
            v.ai = { relevant: a.relevant, tone: a.tone, frame: a.frame, model, at: new Date().toISOString() };
            if (v.summarySrc !== "manual") {
              v.summary = a.summary;
              v.summarySrc = "ai";
            }
            v.include = decideInclude(v);
          }
          await DB.putMany(b);
          break;
        } catch (err) {
          log(`⚠ AI 묶음 실패 (${attempt + 1}/3): ${err.message}`);
          if (err.status === 401) {
            batches.length = 0;
            break;
          }
          await YT.sleep(4000 * (attempt + 1));
        }
      }
      doneN += b.length;
      stage(`④ AI 요약·판단 ${doneN}/${targets.length}`, 85 + (doneN / targets.length) * 15);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  log(`AI 완료 · 비용 약 ${Math.round(aiWon(input, output, model)).toLocaleString()}원`);
  await reloadVideos();
}

$("#run").addEventListener("click", runCollect);
$("#stop").addEventListener("click", () => {
  stopFlag = true;
  stage("중지하는 중… (지금 하던 것까지 저장)");
});
$("#aiOnly").addEventListener("click", async () => {
  if (running) return;
  if (!confirm("모니터링 기간 안 영상 전부를 AI 로 다시 요약·판단합니다. (직접 고친 요약·포함 여부는 그대로)\n계속할까요?")) return;
  running = true;
  stopFlag = false;
  $("#run").disabled = $("#aiOnly").disabled = true;
  $("#stop").disabled = false;
  try {
    await runAi(true);
    stage("✔ AI 요약·판단 완료", 100);
  } finally {
    running = false;
    $("#run").disabled = $("#aiOnly").disabled = false;
    $("#stop").disabled = true;
  }
});

function ding() {
  try {
    const ctx = new AudioContext();
    [784, 988, 1175].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.55);
    });
  } catch {}
}

async function showLastRun() {
  const { hmLastRun } = await chrome.storage.local.get("hmLastRun");
  $("#lastRun").textContent = hmLastRun ? `마지막 수집 ${fmtDT(hmLastRun.at)} · ${hmLastRun.msg}` : "아직 수집한 적 없음";
}

// 영상 직접 추가
$("#addBtn").addEventListener("click", async () => {
  const ids = [...new Set(String($("#addUrls").value).split(/\s+/).map(YT.videoId).filter(Boolean))];
  if (!ids.length) return ($("#addInfo").textContent = "유튜브 영상 주소를 넣어 주세요.");
  const { hmChannels = {} } = await chrome.storage.local.get("hmChannels");
  const groupById = new Map(Object.values(hmChannels).map((c) => [c.id, c.group]));
  let ok = 0;
  for (const id of ids) {
    $("#addInfo").textContent = `읽는 중… ${ok + 1}/${ids.length}`;
    try {
      const d = await YT.video(id);
      const prev = await DB.get(id);
      const rec = {
        ...(prev || { firstSeen: new Date().toISOString(), history: {} }),
        id,
        url: `https://www.youtube.com/watch?v=${id}`,
        title: d.title,
        channelName: d.channelName,
        channelId: d.channelId,
        channelUrl: d.channelUrl,
        published: d.published ? d.published.toISOString() : null,
        hasTime: d.hasTime,
        views: d.views,
        likes: d.likes,
        comments: d.comments,
        desc: d.desc,
        sources: [...new Set([...(prev?.sources || []), "직접 추가"])],
        updated: new Date().toISOString(),
        manual: true,
      };
      rec.group = groupById.get(rec.channelId) || "other";
      Object.assign(rec, classify(rec, settings));
      if (!rec.summary) {
        rec.summary = ruleSummary(rec);
        rec.summarySrc = "rule";
      }
      rec.include = true;
      await DB.put(rec);
      ok++;
    } catch (e) {
      $("#addInfo").textContent = `⚠ ${id}: ${e.message}`;
    }
  }
  await reloadVideos();
  $("#addInfo").textContent = `✔ ${ok}개 추가했습니다${ok < ids.length ? ` (실패 ${ids.length - ok}개)` : ""}. AI 요약은 'AI 요약·판단만 다시'로 넣을 수 있습니다.`;
  $("#addUrls").value = "";
});

// ---------------------------------------------------------------------------
// DB 화면
// ---------------------------------------------------------------------------
let sortKey = "published";
let sortDesc = true;
function dbList() {
  const q = $("#q").value.trim().toLowerCase();
  const inc = $("#fInc").value;
  const g = $("#fGroup").value;
  const p = periodOf();
  const s = parseYmd(p.start).getTime();
  const e = parseYmd(p.end).getTime() + 86400000;
  let list = videos.filter((v) => {
    if (inc === "inc" && !v.include) return false;
    if (inc === "exc" && v.include) return false;
    if (g !== "all" && v.group !== g) return false;
    if ($("#fPeriod").checked) {
      const t = v.published ? new Date(v.published).getTime() : 0;
      if (t < s || t >= e) return false;
    }
    if (q && !`${v.title} ${v.channelName} ${v.summary || ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const val = (v) => (sortKey === "tone" ? toneOf(v) : sortKey === "published" ? new Date(v.published || 0).getTime() : v[sortKey]);
  list.sort((a, b) => {
    const x = val(a);
    const y = val(b);
    const r = typeof x === "string" || typeof y === "string" ? String(x ?? "").localeCompare(String(y ?? ""), "ko") : (x ?? -1) - (y ?? -1);
    return sortDesc ? -r : r;
  });
  return list;
}

function renderDb() {
  const list = dbList();
  const rows = list.map((v) => {
    const tone = toneOf(v);
    const tc = tone === "부정" ? "neg" : tone === "긍정" ? "pos" : "mid";
    const d = v.published ? new Date(v.published) : null;
    return `<tr data-id="${v.id}" class="${v.include ? "" : "out"}">
      <td><input type="checkbox" class="inc" ${v.include ? "checked" : ""} title="포함(부정 프레임)"></td>
      <td style="white-space:nowrap">${d ? `${ymd(d)}<div class="meta">${pad2(d.getHours())}:${pad2(d.getMinutes())}</div>` : "-"}</td>
      <td><a href="${v.url}" target="_blank"><img class="th" loading="lazy" src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" alt=""></a></td>
      <td style="min-width:120px"><span class="badge" style="background:${GROUP_COLOR[v.group] || "#6b7280"}">${(GROUPS[v.group] || "기타").replace(" 채널", "")}</span><div>${escH(v.channelName)}</div></td>
      <td class="title" style="min-width:320px"><a href="${v.url}" target="_blank">${escH(v.title)}</a>${v.gone ? ' <span class="tone neg">삭제·비공개</span>' : ""}
        <div class="sum" contenteditable="plaintext-only" spellcheck="false">${escH(v.summary || "")}</div>
        <div class="meta">${v.ai?.frame ? `${escH(v.ai.frame)} · ` : ""}${(v.negHits || []).length ? `<span class="kw">부정 표현: ${escH(v.negHits.join(", "))}</span> · ` : ""}${escH((v.sources || []).slice(0, 3).join(", "))}</div></td>
      <td class="r">${num(v.views)}</td>
      <td class="r">${num(v.likes)}</td>
      <td class="r">${num(v.comments)}</td>
      <td><span class="tone ${tc}">${tone || "-"}</span>${v.ai ? "" : '<div class="meta">단어 판단</div>'}</td>
      <td><button class="del" title="DB 에서 지우기">🗑</button></td>
    </tr>`;
  });
  $("#rows").innerHTML = rows.join("") || `<tr><td colspan="10" class="hint" style="padding:20px">표시할 영상이 없습니다.</td></tr>`;
  const inc = videos.filter((v) => v.include).length;
  $("#dbInfo").textContent = `보이는 영상 ${list.length}개 · DB 전체 ${videos.length}개 (포함 ${inc}개) — 포함 칸 체크로 부정 프레임 여부를 직접 바꾸고, 요약은 눌러서 고칠 수 있습니다.`;
}
["#q", "#fInc", "#fGroup", "#fPeriod"].forEach((s) => $(s).addEventListener("input", renderDb));
document.querySelectorAll("table.db th[data-k]").forEach((th) =>
  th.addEventListener("click", () => {
    if (sortKey === th.dataset.k) sortDesc = !sortDesc;
    else {
      sortKey = th.dataset.k;
      sortDesc = true;
    }
    renderDb();
  }),
);
$("#rows").addEventListener("change", async (e) => {
  if (!e.target.classList.contains("inc")) return;
  const id = e.target.closest("tr").dataset.id;
  const v = videos.find((x) => x.id === id);
  v.manual = e.target.checked;
  v.include = e.target.checked;
  await DB.put(v);
  e.target.closest("tr").classList.toggle("out", !v.include);
  await reloadVideos();
});
$("#rows").addEventListener(
  "blur",
  async (e) => {
    if (!e.target.classList.contains("sum")) return;
    const id = e.target.closest("tr").dataset.id;
    const v = videos.find((x) => x.id === id);
    const t = e.target.textContent.trim();
    if (t === (v.summary || "")) return;
    v.summary = t;
    v.summarySrc = "manual";
    await DB.put(v);
  },
  true,
);
$("#rows").addEventListener("click", async (e) => {
  if (!e.target.classList.contains("del")) return;
  const id = e.target.closest("tr").dataset.id;
  const v = videos.find((x) => x.id === id);
  if (!confirm(`DB 에서 지울까요?\n\n${v.title}\n\n(다음 수집 때 다시 찾아지면 다시 들어옵니다. 빼고만 싶으면 '포함' 체크를 푸세요.)`)) return;
  await DB.del(id);
  await reloadVideos();
  renderDb();
});
$("#xlsxDb").addEventListener("click", () => {
  const list = dbList().sort((a, b) => new Date(a.published) - new Date(b.published));
  const ids = new Set(list.map((v) => v.id));
  const st = computeStats(
    videos.filter((v) => ids.has(v.id)),
    { ...periodOf(), all: true, start: $("#fPeriod").checked ? periodOf().start : "2000-01-01" },
  );
  downloadExcel(st, "DB", $("#dbInfo"));
});
$("#backup").addEventListener("click", async () => {
  const data = { app: "hyundai-yt-monitor", at: new Date().toISOString(), settings, videos: await DB.all() };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `현대차위기론_유튜브모니터링_백업_${todayYmd()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
});
$("#restore").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.videos)) throw new Error("백업 파일이 아닙니다");
    await DB.putMany(data.videos);
    await reloadVideos();
    renderDb();
    $("#dbInfo").textContent = `✔ 영상 ${data.videos.length}개를 가져왔습니다.`;
  } catch (err) {
    $("#dbInfo").textContent = `가져오지 못했습니다: ${err.message}`;
  }
  e.target.value = "";
});

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------
async function fillSettings() {
  $("#sStart").value = settings.start;
  $("#sEnd").value = settings.end;
  $("#sManaged").value = settings.managed;
  $("#sEcon").value = settings.econ;
  $("#sChQ").value = settings.channelQueries;
  $("#sQueries").value = settings.queries;
  $("#sPages").value = settings.searchPages;
  $("#sTopic").value = settings.topicWords;
  $("#sNeg").value = settings.negWords;
  $("#sPos").value = settings.posWords;
  $("#aiModel").innerHTML = AI_MODELS.map(([id, name]) => `<option value="${id}">${name}</option>`).join("");
  $("#aiModel").value = settings.ai.model;
  $("#aiOn").checked = settings.ai.on;
  const { hmAiKey, hmChannels = {} } = await chrome.storage.local.get(["hmAiKey", "hmChannels"]);
  $("#aiKey").value = hmAiKey || "";
  $("#aiState").textContent = hmAiKey && settings.ai.on ? `(Claude ${settings.ai.model.split("-")[1]})` : "(API 키 없음 → 설명 요약·단어 판단)";
  const chs = Object.values(hmChannels);
  $("#chanList").textContent = chs.length
    ? `확인된 채널 ${chs.length}곳: ` + chs.map((c) => `${c.name}(${c.group === "managed" ? "관리" : "경제"})`).join(", ")
    : "아직 채널을 확인하지 않았습니다 (첫 수집 때 확인).";
}

$("#save").addEventListener("click", async () => {
  settings = {
    ...settings,
    start: $("#sStart").value || DEFAULTS.start,
    end: $("#sEnd").value,
    managed: $("#sManaged").value,
    econ: $("#sEcon").value,
    channelQueries: $("#sChQ").value,
    queries: $("#sQueries").value,
    searchPages: Math.max(1, Math.min(30, +$("#sPages").value || 6)),
    topicWords: $("#sTopic").value,
    negWords: $("#sNeg").value,
    posWords: $("#sPos").value,
    ai: { on: $("#aiOn").checked, model: $("#aiModel").value },
  };
  await saveSettings(settings);
  await chrome.storage.local.set({ hmAiKey: $("#aiKey").value.trim() });
  // 단어를 바꿨으면 DB 영상의 단어 판단도 다시
  const all = await DB.all();
  for (const v of all) {
    Object.assign(v, classify(v, settings));
    v.include = decideInclude(v);
  }
  await DB.putMany(all);
  await reloadVideos();
  heroSub();
  await fillSettings();
  $("#saveInfo").textContent = "✔ 저장했습니다.";
  $("#saveInfo").className = "hint ok";
});
$("#reset").addEventListener("click", async () => {
  if (!confirm("설정을 기본값으로 되돌릴까요? (DB 와 API 키는 그대로)")) return;
  settings = { ...DEFAULTS, ai: { ...DEFAULTS.ai } };
  await saveSettings(settings);
  await fillSettings();
  heroSub();
});

// ---------------------------------------------------------------------------
(async function init() {
  $("#ver").textContent = `v${chrome.runtime.getManifest().version}`;
  settings = await loadSettings();
  await reloadVideos();
  heroSub();
  const p = periodOf();
  $("#dStart").value = p.start;
  $("#dEnd").value = p.end;
  await fillSettings();
  showLastRun();
  showTab();
})();
