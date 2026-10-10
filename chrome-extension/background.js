// 확장 아이콘을 누르면 수집 화면을 새 탭으로 연다.
// (팝업은 다른 곳을 클릭하면 닫혀서 오래 걸리는 수집이 중단되므로 탭을 사용)
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
});

// 이 확장에서 보내는 네이버/유튜브 요청에 해당 사이트 페이지와 같은 Referer/Origin 을 붙인다.
async function installHeaderRules() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1, 2],
    addRules: [
      {
        id: 1,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "Referer", operation: "set", value: "https://cafe.naver.com/" },
            { header: "Origin", operation: "set", value: "https://cafe.naver.com" },
          ],
        },
        condition: {
          requestDomains: ["apis.naver.com", "cafe.naver.com"],
          initiatorDomains: [chrome.runtime.id],
          resourceTypes: ["xmlhttprequest"],
        },
      },
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
    ],
  });
}

chrome.runtime.onInstalled.addListener(installHeaderRules);
chrome.runtime.onStartup.addListener(installHeaderRules);
