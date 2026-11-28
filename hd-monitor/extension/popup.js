const KEYS = ["on", "endpoint", "token", "boards", "every"];
const DEF = { on: true, endpoint: "https://hd-issue-monitor.web.app/api/ingest", token: "", boards: "car | 뽐뿌 자동차포럼\nfreeboard | 뽐뿌 자유게시판", every: 5 };
const $ = (id) => document.getElementById(id);
const t = (ms) => (ms ? new Date(ms).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");
const line = (s) => (s.error ? `<span class="err">✕ ${s.error}</span>` : `<span class="ok">✓ 보냄 ${s.sent}건 · 새로 저장 ${s.created}건</span>`) + (s.naver ? `<br><span class="hint">${s.naver}</span>` : "") + (s.ppomppu ? `<br><span class="hint">${s.ppomppu}</span>` : "") + (s.news ? `<br><span class="hint">${s.news}</span>` : "");

async function load() {
  const c = { ...DEF, ...(await chrome.storage.local.get(KEYS)) };
  $("on").checked = !!c.on; $("endpoint").value = c.endpoint; $("token").value = c.token; $("boards").value = c.boards; $("every").value = c.every;
  const { last, log = [] } = await chrome.storage.local.get(["last", "log"]);
  $("st").innerHTML = last ? `마지막 수집 ${t(last.at)}<br>${line(last)}` : "아직 수집 기록이 없습니다";
  $("log").innerHTML = log.map((s) => `${t(s.at)} ${line(s)}`).join("<br>");
}
$("save").onclick = async () => {
  await chrome.storage.local.set({ on: $("on").checked, endpoint: $("endpoint").value.trim(), token: $("token").value.trim(), boards: $("boards").value, every: Number($("every").value) || 5 });
  await chrome.runtime.sendMessage("reschedule");
  $("st").textContent = "저장했습니다";
};
$("run").onclick = async () => {
  $("save").click();
  $("st").textContent = "수집 중…";
  await chrome.runtime.sendMessage("runNow");
  load();
};
load();
