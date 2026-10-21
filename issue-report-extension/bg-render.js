// 이 확장이 뒤쪽 탭으로 연 카페 화면(주소 끝 #imrbg 표시)에서만 동작:
// 크롬은 보이지 않는 탭에서 화면 그리기(requestAnimationFrame)·보이는지 확인(IntersectionObserver)을 멈추는데,
// 새 카페 화면은 이것들이 돌아야 글 목록을 그린다. 그래서 이 탭에서만 '보이는 탭'처럼 동작하게 한다.
// (사용자가 직접 연 카페 탭에는 표시가 없으므로 아무것도 바꾸지 않음)
(() => {
  let on = false;
  try {
    if (location.hash.includes("imrbg")) sessionStorage.setItem("imrbg", "1");
    on = sessionStorage.getItem("imrbg") === "1";
  } catch {
    on = location.hash.includes("imrbg");
  }
  if (!on) return;

  try {
    Object.defineProperty(Document.prototype, "hidden", { get: () => false, configurable: true });
    Object.defineProperty(Document.prototype, "visibilityState", { get: () => "visible", configurable: true });
    Document.prototype.hasFocus = () => true;
  } catch {
    /* 무시 */
  }
  document.addEventListener("visibilitychange", (e) => e.stopImmediatePropagation(), true);

  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
  window.cancelAnimationFrame = (id) => clearTimeout(id);

  const IO = window.IntersectionObserver;
  if (IO) {
    window.IntersectionObserver = class extends IO {
      constructor(cb, opts) {
        super(cb, opts);
        this._imrcb = cb;
      }
      observe(el) {
        super.observe(el);
        setTimeout(() => {
          const r = el.getBoundingClientRect();
          try {
            this._imrcb([{ target: el, isIntersecting: true, intersectionRatio: 1, boundingClientRect: r, intersectionRect: r, rootBounds: null, time: performance.now() }], this);
          } catch {
            /* 무시 */
          }
        }, 50);
      }
    };
  }
})();
