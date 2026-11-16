// 파일 저장: 고른 폴더(📁 File System Access — 핸들은 DB 'kv' 에 보관) > 크롬 다운로드 폴더(하위 폴더 · 매번 묻기)
// 맥: 크롬은 받은 파일마다 '출처'(chrome-extension://…) 정보를 붙이고 확장프로그램은 이를 막을 수 없다
//  → 저장이 끝나면 빠른다운로드 도우미(com.khagu77.ytdl)가 지운다 (background 의 meta-clean.js). GV90 수집기와 같은 방식.
const IS_MAC = /Mac/i.test(navigator.userAgent);

async function getSaveDir() {
  return (await DB.kvGet("saveDir").catch(() => null)) || null;
}

async function pickSaveDir() {
  const handle = await window.showDirectoryPicker({ id: "hyundai-yt-monitor-save", mode: "readwrite" });
  await DB.kvSet("saveDir", handle);
  return handle;
}

async function clearSaveDir() {
  await DB.kvDel("saveDir").catch(() => {});
}

// 버튼을 누르자마자(클릭 직후) 고른 폴더 쓰기 허락을 받아 둠 — 엑셀을 만드는 동안 클릭 효력이 끝나
// 허락 창을 못 띄우고 다운로드(출처 붙음)로 빠지는 것을 막음
async function prepareSaveDir() {
  try {
    const dir = await getSaveDir();
    if (dir && (await dir.queryPermission({ mode: "readwrite" })) !== "granted") await dir.requestPermission({ mode: "readwrite" });
  } catch {
    /* 허락 못 받으면 저장할 때 다운로드 폴더로 */
  }
}

function cleanFileName(name) {
  return String(name || "파일").replace(/[\\/:*?"<>|]/g, "_").trim();
}
function cleanSubFolder(f) {
  return String(f || "")
    .split(/[\\/]+/)
    .map((x) => x.replace(/[:*?"<>|]/g, "_").trim())
    .filter((x) => x && x !== "." && x !== "..")
    .join("/");
}

function bytesToDataUrl(bytes, mime) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(new Blob([bytes], { type: mime }));
  });
}

// 저장 → 어디에 저장했는지 글로 돌려줌
async function saveFile(bytes, name, mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
  name = cleanFileName(name);
  const dir = await getSaveDir();
  if (dir) {
    try {
      let perm = await dir.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") perm = await dir.requestPermission({ mode: "readwrite" });
      if (perm === "granted") {
        let target = name;
        for (let i = 1; i < 100; i++) {
          try {
            await dir.getFileHandle(target);
            target = name.replace(/(\.[a-z]+)?$/i, ` (${i})$1`);
          } catch {
            break;
          }
        }
        const fh = await dir.getFileHandle(target, { create: true });
        const w = await fh.createWritable();
        await w.write(bytes);
        await w.close();
        // 맥: 고른 폴더의 전체 경로를 알아야 도우미가 파일을 찾아 '출처'를 지움
        if (IS_MAC) {
          let base = String(settings.macFolderPath || "").trim().replace(/\/+$/, "");
          if (base && base.split("/").pop() !== dir.name) base = `${base.replace(/\/[^/]*$/, "")}/${dir.name}`;
          if (base) chrome.runtime.sendMessage({ type: "gvCleanMeta", path: `${base}/${target}` }).catch(() => {});
          else showCleanNotice({ ok: false, reason: "nopath", name: target });
        }
        return `📁 '${dir.name}' 폴더에 ${target}`;
      }
    } catch {
      /* 아래 다운로드로 */
    }
  }
  const folder = cleanSubFolder(settings.saveFolder);
  const ask = !!settings.saveAsk;
  // data: 주소로 받는다 (blob: 으로 받으면 맥 '출처'에 확장 주소가 남음)
  const url = await bytesToDataUrl(bytes, mime);
  await registerClean(name);
  try {
    await chrome.downloads.download({ url, filename: folder ? `${folder}/${name}` : name, saveAs: ask, conflictAction: "uniquify" });
  } catch {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  }
  return ask ? `고른 위치에 ${name}` : `다운로드${folder ? ` / ${folder}` : ""} 폴더에 ${name}`;
}

async function saveWhereText() {
  const dir = await getSaveDir();
  if (dir) return `저장 위치: 📁 ${dir.name}`;
  const folder = cleanSubFolder(settings?.saveFolder);
  return `저장 위치: 크롬 다운로드 폴더${folder ? ` / ${folder}` : ""}${settings?.saveAsk ? " (받을 때마다 묻기)" : ""}`;
}

// 맥 '출처' 지우기: 받기 전에 파일 이름을 적어 두면 백그라운드(meta-clean.js)가 받기가 끝난 뒤 도우미로 지움
async function registerClean(name) {
  if (!IS_MAC) return;
  try {
    const { pendingClean = [] } = await chrome.storage.session.get("pendingClean");
    const now = Date.now();
    await chrome.storage.session.set({ pendingClean: [...pendingClean.filter((p) => p.until > now), { name, until: now + 10 * 60e3 }] });
  } catch {
    /* 무시 */
  }
}

const CLEAN_NOTICE = {
  ok: "✔ 저장한 파일의 '출처' 정보를 지웠습니다.",
  old: "⚠ 빠른다운로드 도우미가 예전 버전이라 '출처' 정보를 지우지 못했습니다. 이 프로그램 압축 안의 '빠른다운로드_도우미설치.app'을 한 번 다시 실행해 주세요.",
  none: "⚠ 빠른다운로드 도우미가 이 프로그램에 연결되지 않아 '출처' 정보를 지우지 못했습니다. 이 프로그램 압축 안의 '빠른다운로드_도우미설치.app'을 한 번 실행해 주세요.",
  refused: "⚠ '출처' 정보를 지우지 못했습니다(내 폴더 밖이거나 경로가 다른 파일). ⚙ 설정의 '저장 폴더 전체 경로'를 확인해 주세요.",
  denied: "⚠ 맥 권한에 막혀 '출처' 정보를 지우지 못했습니다. 시스템 설정 → 개인정보 보호 및 보안 → '전체 디스크 접근 권한'에 Google Chrome 을 켜 주세요(저장 폴더가 데스크탑·문서 안일 때).",
  nopath: "⚠ '출처' 정보를 지우려면 ⚙ 설정에 고른 저장 폴더의 '전체 경로'를 한 번 넣어 주세요.",
  error: "⚠ '출처' 정보를 지우는 중 오류가 났습니다.",
};

function showCleanNotice(r) {
  const el = document.getElementById("cleanNotice");
  if (!el) return;
  el.hidden = false;
  el.className = `clean-notice ${r.ok ? "ok" : "err"}`;
  el.textContent = `${CLEAN_NOTICE[r.ok ? "ok" : r.reason] || CLEAN_NOTICE.error}${r.name ? ` (${r.name})` : ""}`;
  clearTimeout(showCleanNotice.t);
  showCleanNotice.t = setTimeout(() => (el.hidden = true), r.ok ? 6000 : 20000);
}
// 백그라운드가 지운 결과
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && ch.lastClean?.newValue) showCleanNotice(ch.lastClean.newValue);
});

// 저장 폴더 출처 모두 지우기 (엑셀에서 고쳐 저장하면 '출처'가 다시 붙을 수 있음) — 버튼 클릭 직후 불러야 허락 창을 띄울 수 있음
async function cleanSaveFolder(info) {
  const say = (t, cls = "") => {
    info.textContent = t;
    info.className = `hint ${cls}`;
  };
  if (!IS_MAC) return say("맥에서만 필요한 기능입니다 (윈도우는 '출처' 정보가 없음).");
  const dir = await getSaveDir();
  if (!dir) return say("⚠ 위에서 저장 폴더를 먼저 골라 주세요.", "err");
  let base = String($("#macFolderPath").value || settings.macFolderPath || "").trim().replace(/\/+$/, "");
  if (!base) return say("⚠ 고른 저장 폴더의 '전체 경로'를 한 번 넣어 주세요.", "err");
  if (base.split("/").pop() !== dir.name) base = `${base.replace(/\/[^/]*$/, "")}/${dir.name}`;
  try {
    if ((await dir.queryPermission({ mode: "read" })) !== "granted" && (await dir.requestPermission({ mode: "read" })) !== "granted") return say("⚠ 저장 폴더를 읽을 허락을 받지 못했습니다.", "err");
  } catch (e) {
    return say(`⚠ 저장 폴더를 열지 못했습니다: ${e.message}`, "err");
  }
  const names = [];
  for await (const [name, h] of dir.entries()) if (h.kind === "file" && /\.(xlsx|txt|json)$/i.test(name) && !name.startsWith("~$")) names.push(name);
  if (!names.length) return say(`'${dir.name}' 폴더에 엑셀 파일이 없습니다.`);
  let ok = 0;
  const bad = [];
  for (let i = 0; i < names.length; i++) {
    say(`⏳ '${dir.name}' 폴더 출처 지우는 중… ${i + 1}/${names.length}`);
    const r = await chrome.runtime.sendMessage({ type: "gvCleanMetaNow", path: `${base}/${names[i]}` }).catch((e) => ({ ok: false, reason: "error", detail: e.message }));
    if (r?.ok) ok++;
    else {
      bad.push({ name: names[i], reason: r?.reason || "error" });
      if (r?.reason === "none" || r?.reason === "old") break; // 도우미 문제면 나머지도 안 됨
    }
  }
  if (!bad.length) return say(`✔ '${dir.name}' 폴더 파일 ${ok}개의 '출처' 정보를 모두 지웠습니다. (Finder 정보 창은 닫았다 다시 열면 바뀝니다)`, "ok");
  say(`${ok ? `✔ ${ok}개 지움 · ` : ""}⚠ ${bad.length}개 못 지움: ${CLEAN_NOTICE[bad[0].reason] || bad[0].reason} (${bad.slice(0, 3).map((b) => b.name).join(", ")}${bad.length > 3 ? " …" : ""})`, "err");
}
