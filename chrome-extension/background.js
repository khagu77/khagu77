// 확장 아이콘을 누르면 'LX3 팰리세이드 전동 시트 관련' 화면을 새 탭으로 연다(위쪽 메뉴로 댓글 수집 화면 이동).
// (팝업은 다른 곳을 클릭하면 닫혀서 오래 걸리는 수집이 중단되므로 탭을 사용)
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("lx3.html") });
});

// 이 확장에서 보내는 유튜브 요청에 유튜브 페이지와 같은 Referer/Origin 을 붙인다.
// (예전 버전의 네이버용 규칙 1번은 지운다 - 네이버는 이제 화면을 열어서만 읽음)
async function installHeaderRules() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1, 2],
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
    ],
  });
}

chrome.runtime.onInstalled.addListener(installHeaderRules);
chrome.runtime.onStartup.addListener(installHeaderRules);
