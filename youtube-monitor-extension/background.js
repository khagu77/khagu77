// 확장 아이콘을 누르면 모니터링 화면을 새 탭으로 연다.
// (팝업은 다른 곳을 클릭하면 닫혀 오래 걸리는 수집이 끊기므로 탭을 쓴다)
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
});
