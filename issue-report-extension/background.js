// 확장 아이콘 → '이슈 모니터링 보고서 작성' 화면을 탭으로 연다 (이미 열려 있으면 그 탭으로).
// (팝업은 다른 곳을 클릭하면 닫혀서 오래 걸리는 수집이 중단되므로 탭을 사용)
const APP_URL = chrome.runtime.getURL("app.html");

async function appTabs() {
  try {
    const ctxs = await chrome.runtime.getContexts({ contextTypes: ["TAB"] });
    return ctxs.filter((c) => c.tabId >= 0 && String(c.documentUrl || "").startsWith(APP_URL)).map((c) => ({ id: c.tabId, windowId: c.windowId }));
  } catch {
    return [];
  }
}

chrome.action.onClicked.addListener(async () => {
  const [tab] = await appTabs();
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: APP_URL });
});

// 이 확장에서 보내는 요청에만 사이트 화면과 같은 Referer/Origin 을 붙인다.
//  2: 유튜브 댓글(웹페이지가 쓰는 내부 API)
//  3: 네이버 뉴스 댓글(댓글 상자 API 는 기사 화면에서 부른 것처럼 Referer 가 있어야 응답)
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
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "Referer", operation: "set", value: "https://n.news.naver.com/" }],
        },
        condition: { requestDomains: ["apis.naver.com"], initiatorDomains: [chrome.runtime.id], resourceTypes: ["xmlhttprequest"] },
      },
    ],
  });
}

chrome.runtime.onInstalled.addListener(installHeaderRules);
chrome.runtime.onStartup.addListener(installHeaderRules);
