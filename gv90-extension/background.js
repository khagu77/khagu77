// GV90 수집기 백그라운드
//  - 확장 아이콘 → 수집 화면 열기 (이미 열려 있으면 그 탭으로)
//  - 자동 수집 (온라인 오전 일일동향과 같은 방식): 매일 정해진 시각(기본 06:00)에 수집 화면을 ?auto=1 로 열어 수집 시작
//    · 휴일(주말·공휴일·회사 휴무)엔 수집만 해 데일리 DB 에 두고(설정에서 '휴일에도 수집'을 끄면 쉼), 근무일 아침에 합쳐 엑셀로 저장
//    · 그 시각에 PC·크롬이 꺼져 있었으면 그날 정오 전에 크롬이 켜질 때 한 번
//    · 직접 돌리는 수집이 있으면 10분마다 다시 확인 (정오까지)
//    · 수집 감시: 진행 신호가 5분 넘게 없으면(크롬이 뒤쪽 탭을 얼렸거나 PC 가 잠들었다 깬 경우) 수집 탭을 앞으로 가져와 깨운다
//  - 유튜브·네이버 뉴스 댓글 요청에 사이트와 같은 Referer 를 붙이는 규칙 (이슈 모니터링 보고서와 같음)
importScripts("gv90-settings.js");

const APP_URL = chrome.runtime.getURL("gv90.html");
const ALARM = "gv90-daily-collect";
const RETRY = "gv90-daily-collect-retry";
const WATCHDOG = "gv90-run-watchdog";
const STALL_MS = 5 * 60 * 1000;

// 열려 있는 수집 화면 탭들
async function appTabs() {
  try {
    const ctxs = await chrome.runtime.getContexts({ contextTypes: ["TAB"] });
    return ctxs.filter((c) => c.tabId >= 0 && String(c.documentUrl || "").startsWith(APP_URL)).map((c) => ({ id: c.tabId, windowId: c.windowId, url: c.documentUrl }));
  } catch {
    return [];
  }
}

// 띄워 둔 수집 화면이 지금 쉬고 있는지 (수집 중이 아니면 true, 2초 안에 대답이 없으면 false)
async function appTabIdle(tabId) {
  try {
    const res = await Promise.race([chrome.runtime.sendMessage({ type: "appIdle?", tabId }), new Promise((r) => setTimeout(() => r(null), 2000))]);
    return !!(res && res.idle);
  } catch {
    return false;
  }
}

async function openApp(auto) {
  const url = auto ? `${APP_URL}?auto=1` : APP_URL;
  const tabs = await appTabs();
  if (!auto && tabs.length) {
    const t = tabs.find((x) => x.url.includes("auto=1")) || tabs[0];
    await chrome.tabs.update(t.id, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
    return;
  }
  if (auto) {
    // 지난 자동 수집 탭이 남아 있으면 그 탭에서 다시 시작
    const old = tabs.find((t) => t.url.includes("auto=1"));
    if (old) {
      await chrome.tabs.update(old.id, { url: `${url}&t=${Date.now()}` });
      return;
    }
    // 띄워 둔 수집 화면이 쉬고 있으면 그 화면에서 자동 수집 시작
    for (const t of tabs) {
      if (await appTabIdle(t.id)) {
        await chrome.tabs.update(t.id, { url: `${url}&t=${Date.now()}` });
        return;
      }
    }
  }
  await chrome.tabs.create({ url: auto ? `${url}&t=${Date.now()}` : url, active: !auto });
}

chrome.action.onClicked.addListener(() => openApp(false));

// 다른 탭에서 수집이 진행 중인지 (진행 신호가 10분 안에 있었으면)
async function runInProgress() {
  const { gvRunHeartbeat: hb } = await chrome.storage.local.get("gvRunHeartbeat");
  return !!(hb && Date.now() - hb.at < 10 * 60 * 1000 && (await appTabs()).length);
}

function todayKeyBg(d = new Date()) {
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
  const { gvLastAutoRun } = await chrome.storage.local.get("gvLastAutoRun");
  if (gvLastAutoRun === todayKeyBg()) return; // 오늘 이미 함
  const s = await loadSettings();
  if (s.workdayReport && !s.collectOnHolidays && !isWorkday(new Date(), s)) return; // 휴일엔 쉬기로 함
  if (await runInProgress()) {
    if (new Date().getHours() < 12) chrome.alarms.create(RETRY, { delayInMinutes: 10 });
    return;
  }
  await chrome.storage.local.set({ gvLastAutoRun: todayKeyBg() });
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
  if (alarm.name === RETRY) {
    const s = await loadSettings();
    if (s.autoRun) await startAutoRun();
    return;
  }
  if (alarm.name === WATCHDOG) {
    const { gvRunHeartbeat, gvWatchdogNudgedAt = 0 } = await chrome.storage.local.get(["gvRunHeartbeat", "gvWatchdogNudgedAt"]);
    const tabs = await appTabs();
    if (!gvRunHeartbeat || !tabs.length) {
      await chrome.alarms.clear(WATCHDOG);
      return;
    }
    const now = Date.now();
    if (now - gvRunHeartbeat.at < STALL_MS || now - gvWatchdogNudgedAt < STALL_MS) return;
    await chrome.storage.local.set({ gvWatchdogNudgedAt: now });
    const tab = tabs.find((t) => t.url.includes("auto=1")) || tabs[0];
    try {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true, drawAttention: true });
    } catch {}
    return;
  }
  if (alarm.name !== ALARM) return;
  await schedule(); // 다음 날 예약
  const s = await loadSettings();
  if (s.autoRun) await startAutoRun();
});

// 헤더 규칙 (이슈 모니터링 보고서와 같음)
async function installHeaderRules() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [2, 3],
    addRules: [
      {
        id: 2,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "Referer", operation: "set", value: "https://www.youtube.com/" },
            { header: "Origin", operation: "set", value: "https://www.youtube.com" },
          ],
        },
        condition: { requestDomains: ["www.youtube.com"], initiatorDomains: [chrome.runtime.id], resourceTypes: ["xmlhttprequest"] },
      },
      {
        id: 3,
        priority: 1,
        action: { type: "modifyHeaders", requestHeaders: [{ header: "Referer", operation: "set", value: "https://n.news.naver.com/" }] },
        condition: { requestDomains: ["apis.naver.com"], initiatorDomains: [chrome.runtime.id], resourceTypes: ["xmlhttprequest"] },
      },
    ],
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await installHeaderRules();
  await schedule();
});
chrome.runtime.onStartup.addListener(async () => {
  await installHeaderRules();
  await schedule();
  await catchUp();
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.gvSettings) schedule();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === "runStarted") chrome.alarms.create(WATCHDOG, { periodInMinutes: 1 });
  if (msg.type === "runEnded") chrome.alarms.clear(WATCHDOG);
  if (msg.type === "autoRunDone") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: msg.holiday ? "GV90 일일 수집: 휴일 수집 완료" : msg.ok === false ? "GV90 일일 수집: 확인이 필요합니다" : "GV90 일일 수집 완료",
      message: msg.holiday
        ? `${msg.count}건 수집 (${msg.holiday}) → 다음 근무일 아침 엑셀에 합쳐집니다.`
        : msg.message || `${msg.count}건을 엑셀로 저장했습니다${msg.where ? ` (${msg.where})` : ""}.`,
    });
  }
});
