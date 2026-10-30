// 확장 아이콘을 누르면 'LX3 팰리세이드 전동 시트 관련' 화면을 새 탭으로 연다(위쪽 메뉴로 댓글 수집 화면 이동).
// (팝업은 다른 곳을 클릭하면 닫혀서 오래 걸리는 수집이 중단되므로 탭을 사용)
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("lx3.html") });
});

// 이 확장에서 보내는 유튜브 요청에 유튜브 페이지와 같은 Referer/Origin 을 붙인다.
// 네이버 뉴스 댓글 상자 요청에는 뉴스 화면과 같은 Referer 를 붙인다 (기사 댓글 읽기).
// (예전 버전의 네이버용 규칙 1번은 지운다 - 카페는 화면을 열어서만 읽음)
async function installHeaderRules() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1, 2, 3],
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
        condition: {
          requestDomains: ["www.youtube.com"],
          initiatorDomains: [chrome.runtime.id],
          resourceTypes: ["xmlhttprequest"],
        },
      },
      {
        id: 3,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "Referer", operation: "set", value: "https://n.news.naver.com/" }],
        },
        condition: {
          requestDomains: ["apis.naver.com"],
          initiatorDomains: [chrome.runtime.id],
          resourceTypes: ["xmlhttprequest"],
        },
      },
    ],
  });
}

chrome.runtime.onInstalled.addListener(installHeaderRules);
chrome.runtime.onStartup.addListener(installHeaderRules);

// 받은 엑셀·txt 파일의 맥 '출처' 정보 지우기 (meta-clean.js)
importScripts("meta-clean.js", "holidays.js");

// ---------------------------------------------------------------------------
// 자동 수집 ('온라인 오전 일일동향'과 같은 방식): 평일 정해진 시각(기본 오전 11:30)에 LX3 화면을 ?auto=1 로 열어
// 게시물 찾기 → 게시물 엑셀 저장 → 댓글 수집 → 댓글 엑셀 저장까지 한다.
// - 주말·공휴일·추가 휴일엔 쉬고, 다음 근무일에 지난번 저장 이후(휴일 포함)를 이어서 모은다 (LX3 화면이 기간을 정함)
// - 그 시각에 PC·크롬이 꺼져 있었으면 그날 크롬이 켜질 때 한 번 (오후 8시 전까지)
// - 직접 돌리는 수집이 있으면 10분 뒤 다시 확인
// ---------------------------------------------------------------------------

const LX3_URL = chrome.runtime.getURL("lx3.html");
const APP_PAGE_URL = chrome.runtime.getURL("app.html");
const AUTO_ALARM = "lx3-auto";
const AUTO_RETRY = "lx3-auto-retry";
const AUTO_LATEST_HOUR = 20; // 이 시각이 지나면 그날은 따라잡지 않음

async function autoSettings() {
  const { lx3Auto, lx3Holidays, lx3BaseTimes } = await chrome.storage.local.get(["lx3Auto", "lx3Holidays", "lx3BaseTimes"]);
  return {
    on: lx3Auto?.on ?? true,
    time: lx3Auto?.time || "11:30",
    endTime: lx3BaseTimes?.to || "11:30",
    extra: parseExtraHolidays(lx3Holidays || ""),
  };
}

function atTime(d, hhmm) {
  const [h, m] = String(hhmm || "11:30").split(":").map(Number);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0);
}

function todayKey(d = new Date()) {
  return ymd(d);
}

// 다음 자동 수집 시각 (쉬는 날은 건너뜀)
function nextAutoRun(s, now = new Date()) {
  let t = atTime(now, s.time);
  if (t <= now) t = atTime(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), s.time);
  for (let i = 0; i < 31 && isHoliday(t, s.extra); i++) t = atTime(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1), s.time);
  return t;
}

async function scheduleAuto() {
  const s = await autoSettings();
  await chrome.alarms.clear(AUTO_ALARM);
  if (s.on) await chrome.alarms.create(AUTO_ALARM, { when: nextAutoRun(s).getTime() });
}

// 열려 있는 LX3·댓글 수집 화면 탭
async function lx3Tabs() {
  try {
    const ctxs = await chrome.runtime.getContexts({ contextTypes: ["TAB"] });
    return ctxs
      .filter((c) => c.tabId >= 0 && [LX3_URL, APP_PAGE_URL].some((u) => String(c.documentUrl || "").startsWith(u)))
      .map((c) => ({ id: c.tabId, windowId: c.windowId }));
  } catch {
    return [];
  }
}

// 찾기·댓글 수집이 진행 중인지 (화면이 30초마다 남기는 신호가 3분 안에 있었으면)
async function lx3Busy() {
  const { lx3RunBeat } = await chrome.storage.local.get("lx3RunBeat");
  return !!(lx3RunBeat && Date.now() - lx3RunBeat < 3 * 60 * 1000 && (await lx3Tabs()).length);
}

// 오늘 이미 했는지: 오늘 자동 수집을 시작했거나, 게시물 리스트를 오늘 기준 시각(끝)까지 저장했으면
async function autoDoneToday(s, now = new Date()) {
  const { lx3LastAutoRun, lx3LastRangeEnd } = await chrome.storage.local.get(["lx3LastAutoRun", "lx3LastRangeEnd"]);
  return lx3LastAutoRun === todayKey(now) || (!!lx3LastRangeEnd && lx3LastRangeEnd >= atTime(now, s.endTime).getTime());
}

async function startAuto() {
  const s = await autoSettings();
  const now = new Date();
  if (!s.on || isHoliday(now, s.extra) || (await autoDoneToday(s, now))) return;
  if (await lx3Busy()) {
    if (now.getHours() < AUTO_LATEST_HOUR) chrome.alarms.create(AUTO_RETRY, { delayInMinutes: 10 });
    return;
  }
  await chrome.storage.local.set({ lx3LastAutoRun: todayKey(now) });
  // 늘 새 탭으로 (보고 있던 화면은 건드리지 않음 · 앞쪽 탭이어야 크롬이 느리게 돌리지 않음)
  await chrome.tabs.create({ url: `${LX3_URL}?auto=1&t=${Date.now()}`, active: true });
}

// 정해진 시각에 PC·크롬이 꺼져 있었으면, 그날 크롬이 켜질 때 한 번
// (게시물 리스트를 한 번이라도 저장해 이어서 모을 기준이 있을 때만 — 막 설치한 크롬이 혼자 시작하지 않게)
async function catchUpAuto() {
  const s = await autoSettings();
  const now = new Date();
  const { lx3LastRangeEnd } = await chrome.storage.local.get("lx3LastRangeEnd");
  if (s.on && lx3LastRangeEnd && now >= atTime(now, s.time) && now.getHours() < AUTO_LATEST_HOUR) await startAuto();
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === AUTO_ALARM) {
    await scheduleAuto(); // 다음 근무일 예약
    await startAuto();
  } else if (alarm.name === AUTO_RETRY) {
    await startAuto();
  }
});
chrome.runtime.onInstalled.addListener(scheduleAuto);
chrome.runtime.onStartup.addListener(async () => {
  await scheduleAuto();
  await catchUpAuto();
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.lx3Auto || changes.lx3Holidays) scheduleAuto();
});

// 자동 수집이 끝나면 알림
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "lx3AutoDone") return;
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: msg.ok ? "LX3 자동 수집 완료" : "LX3 자동 수집: 확인이 필요합니다",
    message: msg.message || "",
  });
});
