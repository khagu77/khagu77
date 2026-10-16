// 확장 아이콘을 누르면 작업 화면을 새 탭으로 연다.
// (팝업은 다른 곳을 클릭하면 닫혀서 오래 걸리는 작업이 중단되므로 탭을 사용)
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("script.html") });
});

// 1) 탭을 열지 않고 확장에서 바로 유튜브 스크립트 데이터를 받을 때, 유튜브 페이지에서 보낸 요청처럼
// Origin/Referer 를 붙인다 (이 확장이 보내는 www.youtube.com 요청에만 적용).
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
        // 수집 화면 안의 보이지 않는 틀(iframe)에 영상 페이지를 열 수 있도록, 이 확장이 연 틀에 한해
        // 유튜브의 '다른 사이트 안에 넣지 말 것' 머리글을 뺀다.
        id: 2,
        priority: 1,
        action: {
          type: "modifyHeaders",
          responseHeaders: [
            { header: "x-frame-options", operation: "remove" },
            { header: "content-security-policy", operation: "remove" },
          ],
        },
        condition: {
          requestDomains: ["www.youtube.com"],
          initiatorDomains: [chrome.runtime.id],
          resourceTypes: ["sub_frame"],
        },
      },
    ],
  });
}

chrome.runtime.onInstalled.addListener(installHeaderRules);
chrome.runtime.onStartup.addListener(installHeaderRules);

// 받은 엑셀·txt 파일의 맥 '출처' 정보 지우기 (meta-clean.js)
importScripts("meta-clean.js");
