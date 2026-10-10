// 확장 아이콘을 누르면 작업 화면을 새 탭으로 연다.
// (팝업은 다른 곳을 클릭하면 닫혀서 오래 걸리는 작업이 중단되므로 탭을 사용)
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("script.html") });
});
