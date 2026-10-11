// 확장 아이콘을 누르면 작업 화면을 새 탭으로 연다.
// (팝업은 다른 곳을 클릭하면 닫혀서 오래 걸리는 작업이 중단되므로 탭을 사용)
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("script.html") });
});

// 탭을 열지 않고 확장에서 바로 유튜브 스크립트 데이터를 받을 때, 유튜브 페이지에서 보낸 요청처럼
// Origin/Referer 를 붙인다 (이 확장이 보내는 www.youtube.com 요청에만 적용).
async function installHeaderRules() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [
      {
        id: 1,
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
    ],
  });
}

chrome.runtime.onInstalled.addListener(installHeaderRules);
chrome.runtime.onStartup.addListener(installHeaderRules);
