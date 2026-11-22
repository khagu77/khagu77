// LX3 카카오톡 알림: 자동 수집(게시물 찾기·댓글 수집)이 시작·끝나거나 오류·네이버 로그인 풀림으로 멈추면
// 카카오톡 '나와의 채팅'으로 알림 (설정에서 켜기 · 직접 시작한 수집은 따로 켜야). 실패해도 수집은 그대로, 진행 기록에만.
const KAKAO_HEAD = "[💺 LX3 전동 시트 관련 💺]";
const KAKAO_KEYS = ["kakaoOn", "kakaoManual", "kakaoRestKey", "kakaoSecret"];

const kakaoHM = (d = new Date()) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const kakaoMD = (d) => `${d.getMonth() + 1}/${d.getDate()} ${kakaoHM(d)}`;

async function kakaoSettings() {
  return chrome.storage.local.get(KAKAO_KEYS).catch(() => ({}));
}

// lines: 머리말 아래에 한 줄씩 (배열 또는 줄바꿈이 든 글자) · auto: 자동 수집이면 true
async function kakaoNotify(lines, { auto = false } = {}) {
  const s = await kakaoSettings();
  if (!s.kakaoOn || !s.kakaoRestKey || typeof Kakao === "undefined") return;
  if (!auto && !s.kakaoManual) return;
  const body = (Array.isArray(lines) ? lines : String(lines).split("\n")).filter(Boolean).join("\n");
  try {
    await Kakao.send(`${KAKAO_HEAD}\n\n${body}`, s); // 머리말 아래 한 줄 띄움
  } catch (e) {
    const msg = `카카오톡 알림을 보내지 못했습니다: ${e.message || e}`;
    if (typeof log === "function") log(`✖ ${msg}`);
    else console.warn(msg);
  }
}

// 설정 화면 '카카오톡 알림' (그 칸이 있는 화면에서만)
async function setupKakao() {
  if (!document.getElementById("kakaoOn")) return;
  const $k = (id) => document.getElementById(id);
  const s = await kakaoSettings();
  $k("kakaoOn").checked = !!s.kakaoOn;
  $k("kakaoManual").checked = !!s.kakaoManual;
  $k("kakaoRestKey").value = s.kakaoRestKey || "";
  $k("kakaoSecret").value = s.kakaoSecret || "";
  $k("kakaoRedirect").textContent = Kakao.redirectUri() || "(확장 프로그램을 새로고침해 주세요)";
  const info = (text, cls = "") => {
    $k("kakaoInfo").textContent = text;
    $k("kakaoInfo").className = `hint ${cls}`;
  };
  const showStatus = async () => {
    const a = await Kakao.status().catch(() => null);
    const exp = a?.refreshExp ? new Date(a.refreshExp) : null;
    $k("kakaoStatus").textContent = a
      ? `✓ 연결됨${exp ? ` (연결 유효 ~${exp.getFullYear()}-${String(exp.getMonth() + 1).padStart(2, "0")}-${String(exp.getDate()).padStart(2, "0")}, 알림을 보내면 자동 연장)` : ""}`
      : "연결 안 됨";
    $k("kakaoStatus").className = a ? "hint ok" : "hint err";
  };
  const saveKeys = () =>
    chrome.storage.local.set({
      kakaoOn: $k("kakaoOn").checked, kakaoManual: $k("kakaoManual").checked,
      kakaoRestKey: $k("kakaoRestKey").value.trim(), kakaoSecret: $k("kakaoSecret").value.trim(),
    });
  for (const id of KAKAO_KEYS) $k(id).addEventListener("change", saveKeys);
  $k("kakaoCopy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(Kakao.redirectUri()).catch(() => {});
    info("리다이렉트 URI를 복사했습니다. 카카오 개발자 사이트에 그대로 등록해 주세요.", "ok");
  });
  $k("kakaoConnect").addEventListener("click", async () => {
    await saveKeys();
    info("카카오 로그인 창을 여는 중…");
    try {
      await Kakao.connect($k("kakaoRestKey").value.trim(), $k("kakaoSecret").value.trim());
      info("✓ 카카오톡을 연결했습니다. [📨 테스트 알림 보내기]로 확인해 보세요.", "ok");
    } catch (e) {
      info(e.message || String(e), "err");
    }
    showStatus();
  });
  $k("kakaoTest").addEventListener("click", async () => {
    await saveKeys();
    try {
      await Kakao.send(`${KAKAO_HEAD}\n\n📨 테스트 알림 (${kakaoHM()})\n자동 수집이 시작·끝나면\n이렇게 알려 드립니다.`, await kakaoSettings());
      info("✓ 테스트 알림을 보냈습니다. 카카오톡 '나와의 채팅'을 확인해 보세요.", "ok");
    } catch (e) {
      info(e.message || String(e), "err");
    }
    showStatus();
  });
  $k("kakaoDisconnect").addEventListener("click", async () => {
    await Kakao.disconnect();
    info("카카오톡 연결을 끊었습니다.");
    showStatus();
  });
  showStatus();
}
