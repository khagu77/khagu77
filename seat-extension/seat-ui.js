// 화면 안 확인 상자: 크롬은 보고 있지 않은 탭(뒤쪽 탭·다른 창)의 confirm()/alert() 창을 막고 '취소'로 처리한다.
// 오래 걸리는 작업 중에 다른 탭을 보고 있으면 확인 창이 막혀 작업이 멈추므로, 화면 안에 상자를 띄우고 답할 때까지 기다린다.
// (기다리는 동안 탭 제목에 '❓ 확인 필요' 표시)

// → Promise<boolean> (확인: true · 취소: false). okOnly 면 확인 버튼만.
function askConfirm(message, { ok = "확인", cancel = "취소", okOnly = false } = {}) {
  if (globalThis.__seatAutoConfirm) {
    // 자동 시험용: 물어본 내용만 남기고 바로 확인
    (globalThis.__seatAsked ||= []).push(message);
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "ask-back";
    back.innerHTML =
      '<div class="ask-box" role="dialog" aria-modal="true"><div class="ask-text"></div>' +
      '<div class="buttons"><button class="primary ask-ok"></button><button class="ask-cancel"></button></div></div>';
    back.querySelector(".ask-text").textContent = message;
    back.querySelector(".ask-ok").textContent = ok;
    const cancelBtn = back.querySelector(".ask-cancel");
    cancelBtn.textContent = cancel;
    cancelBtn.hidden = okOnly;
    const title = document.title;
    document.title = `❓ 확인 필요 - ${title}`;
    const done = (v) => {
      back.remove();
      document.title = title;
      document.removeEventListener("keydown", onKey, true);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        done(okOnly);
      } else if (e.key === "Enter") {
        e.preventDefault();
        done(true);
      }
    };
    back.querySelector(".ask-ok").addEventListener("click", () => done(true));
    cancelBtn.addEventListener("click", () => done(false));
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(back);
    back.querySelector(".ask-ok").focus();
  });
}

function askAlert(message) {
  return askConfirm(message, { okOnly: true });
}
