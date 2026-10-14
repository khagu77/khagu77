// 확장 아이콘 → 수집 화면 열기, 매일 정해진 시각 → 자동 수집 화면을 열어 수집 시작
importScripts("defaults.js");

const APP_URL = chrome.runtime.getURL("app.html");
const ALARM = "daily-collect";

// 열려 있는 수집 화면 탭들 (tabs 권한 없이도 확장 자신의 화면은 getContexts 로 찾을 수 있다)
async function appTabs() {
  try {
    const ctxs = await chrome.runtime.getContexts({ contextTypes: ["TAB"] });
    return ctxs.filter((c) => c.tabId >= 0 && String(c.documentUrl || "").startsWith(APP_URL)).map((c) => ({ id: c.tabId, windowId: c.windowId, url: c.documentUrl }));
  } catch {
    return [];
  }
}

async function openApp(auto) {
  const url = auto ? `${APP_URL}?auto=1` : APP_URL;
  const tabs = await appTabs();
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
  const s = await loadSettings();
  if (s.workdayReport && !s.collectOnHolidays && !isWorkday(new Date(), s)) return; // 휴일엔 쉬기로 함
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

// 수집 감시: 진행 신호가 5분 넘게 없으면(크롬이 뒤쪽 탭을 얼렸거나 맥이 잠들었다 깬 경우) 수집 탭을 앞으로 가져와 깨운다
const WATCHDOG = "run-watchdog";
const STALL_MS = 5 * 60 * 1000;

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== WATCHDOG) return;
  const { runHeartbeat, watchdogNudgedAt = 0 } = await chrome.storage.local.get(["runHeartbeat", "watchdogNudgedAt"]);
  const tabs = await appTabs();
  if (!runHeartbeat || !tabs.length) {
    await chrome.alarms.clear(WATCHDOG);
    return;
  }
  const now = Date.now();
  if (now - runHeartbeat.at < STALL_MS || now - watchdogNudgedAt < STALL_MS) return;
  await chrome.storage.local.set({ watchdogNudgedAt: now });
  const tab = tabs.find((t) => t.url.includes("auto=1")) || tabs[0];
  try {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true, drawAttention: true });
  } catch {}
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "runStarted") chrome.alarms.create(WATCHDOG, { periodInMinutes: 1 });
  if (msg && msg.type === "runEnded") chrome.alarms.clear(WATCHDOG);
  if (msg && msg.type === "autoRunDone") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: msg.holiday ? "부정 이슈 모니터링: 휴일 수집 완료" : "부정 이슈 모니터링 완료",
      message: msg.holiday
        ? `${msg.count}건 수집 (${msg.holiday}) → 다음 근무일 아침 보고서에 합쳐집니다.`
        : msg.blocked
          ? `${msg.count}건 저장 (주의: ${msg.blocked})`
          : `${msg.count}건을 엑셀로 저장했습니다.`,
    });
  }
});
