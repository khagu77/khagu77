// 확장 아이콘 → 수집 화면 열기, 매일 정해진 시각 → 자동 수집 화면을 열어 수집 시작
importScripts("defaults.js");

const APP_URL = chrome.runtime.getURL("app.html");
const ALARM = "daily-collect";

async function openApp(auto) {
  const url = auto ? `${APP_URL}?auto=1` : APP_URL;
  const tabs = await chrome.tabs.query({ url: `${APP_URL}*` });
  if (!auto && tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
    return;
  }
  if (auto && tabs.some((t) => t.url.includes("auto=1"))) return; // 이미 자동 수집 중
  await chrome.tabs.create({ url, active: false });
}

chrome.action.onClicked.addListener(() => openApp(false));

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function nextRunTime(hhmm) {
  const [h, m] = String(hhmm || "06:00").split(":").map(Number);
  const now = new Date();
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
  return t.getTime();
}

async function schedule() {
  const s = await loadSettings();
  await chrome.alarms.clear(ALARM);
  if (s.autoRun) chrome.alarms.create(ALARM, { when: nextRunTime(s.autoRunTime) });
}

async function startAutoRun() {
  const { lastAutoRun } = await chrome.storage.local.get("lastAutoRun");
  if (lastAutoRun === todayKey()) return; // 오늘 이미 함
  await chrome.storage.local.set({ lastAutoRun: todayKey() });
  await openApp(true);
}

// 정해진 시각에 PC 가 꺼져 있었으면, 그날 정오 전에 크롬이 켜질 때 한 번 실행
async function catchUp() {
  const s = await loadSettings();
  if (!s.autoRun) return;
  const [h, m] = String(s.autoRunTime || "06:00").split(":").map(Number);
  const now = new Date();
  const runAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  if (now >= runAt && now.getHours() < 12) await startAutoRun();
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  await schedule(); // 다음 날 예약
  const s = await loadSettings();
  if (s.autoRun) await startAutoRun();
});

chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(async () => {
  await schedule();
  await catchUp();
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) schedule();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "autoRunDone") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "부정 이슈 모니터링 완료",
      message: msg.blocked ? `${msg.count}건 저장 (주의: ${msg.blocked})` : `${msg.count}건을 엑셀로 다운로드 폴더에 저장했습니다.`,
    });
  }
});
