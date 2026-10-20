// 이 확장이 연 탭(주소 끝 #bhcheck 로 연 탭)에서만: 알림창(alert/confirm)을 띄우지 않고 그 글자를 기억해 둔다.
// 삭제된 게시물은 '삭제되었거나 존재하지 않는 게시글입니다' 알림창으로 알려 주는데, 알림창이 뜨면 탭이 멈춰 읽을 수 없기 때문.
// 화면(페이지) 쪽에서 돌아야 alert 를 바꿀 수 있어 MAIN world 로 넣는다. 사용자가 직접 연 탭은 건드리지 않는다.
(() => {
  let ours = false;
  try {
    let topHash = "";
    try {
      topHash = window.top.location.hash;
    } catch {
      /* 다른 사이트 프레임 */
    }
    if (/#bhcheck\b/.test(location.hash)) {
      // 새 글을 열 때마다 지난 글의 알림창 기록은 지운다(같은 화면 안에서 여러 글을 차례로 읽으므로)
      sessionStorage.setItem("bhCheck", "1");
      sessionStorage.removeItem("bhAlert");
    } else if (/#bhcheck\b/.test(topHash)) sessionStorage.setItem("bhCheck", "1");
    ours = sessionStorage.getItem("bhCheck") === "1";
  } catch {
    return;
  }
  if (!ours) return;
  const record = (m) => {
    try {
      const prev = sessionStorage.getItem("bhAlert") || "";
      sessionStorage.setItem("bhAlert", (prev ? prev + "\n" : "") + String(m ?? ""));
    } catch {
      /* 무시 */
    }
  };
  window.alert = (m) => record(m);
  window.confirm = (m) => (record(m), false);
  window.prompt = (m) => (record(m), null);
})();
