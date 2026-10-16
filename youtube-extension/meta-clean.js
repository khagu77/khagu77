// (백그라운드) 맥: 이 확장에서 받은 엑셀·txt 파일의 '출처'(다운로드한 곳) 정보를 빠른다운로드 도우미로 지운다.
// 크롬은 내려받은 파일마다 받은 곳(chrome-extension://…)을 맥 파일 정보 '출처'에 남기고, 확장프로그램이 이를 막을 수 없다.
// 화면이 받을 파일 이름을 pendingClean 에 적어 두면, 저장이 끝났을 때 여기서 도우미에 그 파일만 지워 달라고 한다.
// (화면을 옮기거나 닫아도 백그라운드에서 끝까지 처리) 결과는 lastClean 에 남겨 화면이 알림으로 보여준다.
const META_HELPER = "com.khagu77.ytdl";
const META_HELPER_VERSION = 4; // 도우미에 '출처 지우기'가 들어간 버전

function isMacForClean() {
  return /Mac/i.test(navigator.userAgent) || !!globalThis.__forceCleanMeta;
}

// 받은 파일 이름이 기다리던 이름인지 (크롬이 붙이는 "이름 (1).xlsx" 포함)
function matchesDownloadName(base, name) {
  if (base === name) return true;
  const stem = name.replace(/\.[^.]+$/, "");
  const ext = name.slice(stem.length);
  return base.startsWith(stem) && base.endsWith(ext) && /^ \(\d+\)$/.test(base.slice(stem.length, base.length - ext.length));
}

async function cleanMetaOf(path) {
  if (!isMacForClean()) return { ok: false, reason: "notmac" };
  try {
    const pong = await chrome.runtime.sendNativeMessage(META_HELPER, { action: "ping" });
    if ((pong?.version || 0) < META_HELPER_VERSION) return { ok: false, reason: "old" };
  } catch (e) {
    return { ok: false, reason: "none", detail: String(e?.message || e) };
  }
  const bytes = new TextEncoder().encode(path);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  try {
    const r = await chrome.runtime.sendNativeMessage(META_HELPER, { action: "cleanmeta", b64: btoa(s) });
    return r?.ok ? { ok: true } : { ok: false, reason: "refused" };
  } catch (e) {
    return { ok: false, reason: "error", detail: String(e?.message || e) };
  }
}

async function onDownloadChangedForClean(delta) {
  if (delta.state?.current !== "complete") return;
  const { pendingClean = [] } = await chrome.storage.session.get("pendingClean");
  const now = Date.now();
  const live = pendingClean.filter((p) => p.until > now);
  if (!live.length) return;
  const [item] = await chrome.downloads.search({ id: delta.id });
  if (!item?.filename) return;
  const base = item.filename.split(/[\\/]/).pop();
  const i = live.findIndex((p) => matchesDownloadName(base, p.name));
  if (i < 0) return;
  live.splice(i, 1);
  await chrome.storage.session.set({ pendingClean: live });
  const result = await cleanMetaOf(item.filename);
  if (result.reason !== "notmac") await chrome.storage.local.set({ lastClean: { name: base, ...result, at: Date.now() } });
  return result;
}

chrome.downloads.onChanged.addListener((delta) => {
  onDownloadChangedForClean(delta).catch(() => {});
});
