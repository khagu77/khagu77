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
importScripts("meta-clean.js");
