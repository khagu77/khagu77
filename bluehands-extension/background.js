// 확장 아이콘을 누르면 보고서 화면을 새 탭으로 연다(팝업은 다른 곳을 누르면 닫혀 작성자 확인이 끊기므로 탭 사용).
// 보고일(매주 월요일, 쉬는 날이면 다음 근무일)인데 아직 보고서를 받지 않았으면 아이콘에 '보고'를 띄운다.
importScripts("schedule.js");

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("bluehands.html") });
});

async function updateBadge() {
  const s = await chrome.storage.local.get(["bhExtraHolidays", "bhLastReportDay"]).catch(() => ({}));
  const plan = reportSchedule(new Date(), parseExtraHolidays(s.bhExtraHolidays));
  const due = plan.isReportDay && s.bhLastReportDay !== ymd(plan.today);
  await chrome.action.setBadgeText({ text: due ? "보고" : "" });
  if (due) await chrome.action.setBadgeBackgroundColor({ color: "#002c5f" });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("bh-badge", { periodInMinutes: 60 });
  updateBadge();
});
chrome.runtime.onStartup.addListener(updateBadge);
chrome.alarms.onAlarm.addListener((a) => a.name === "bh-badge" && updateBadge());
chrome.storage.onChanged.addListener((changes) => {
  if (changes.bhLastReportDay || changes.bhExtraHolidays) updateBadge();
});
