// 카페 이름 장부: 카페 주소 ID(소문자) → 카페 이름
// 검색 결과에 이름이 있으면 기억해 두고, 이름 없이 들어온 카페 글은 장부에서 채움.
// 장부에도 없는 카페는 '모르는 카페'로 모아 크롬 수집 도우미가 네이버에서 이름을 알아 와 줌 (서버는 네이버가 막음)
import { db, getState, setState } from "./db.js";

const BOOK = "status/cafeNames"; // 화면도 읽음 (이미 저장된 글의 카페 이름 표시)
const key = (club) => String(club || "").trim().toLowerCase();
const ok = (club) => /^[\w-]{2,40}$/.test(String(club || "")) && !String(club).startsWith("#");

export async function loadBook() {
  return (await db.doc(BOOK).get()).data()?.names || {};
}

// 수집한 글 목록에 적용: 이름 배우기 + 빈 이름 채우기 + 모르는 카페 기록
export async function fillCafeNames(items) {
  const cafes = items.filter((it) => it && it.channel === "cafe" && ok(it.sourceId));
  if (!cafes.length) return;
  const book = await loadBook();
  const learned = {};
  const unknown = new Set();
  for (const it of cafes) {
    const k = key(it.sourceId);
    const name = String(it.source || "").trim();
    if (name && name.toLowerCase() !== k) { if (book[k] !== name) learned[k] = name; }
    else if (book[k]) it.source = book[k];
    else unknown.add(k);
  }
  if (Object.keys(learned).length) await addNames(learned, false);
  if (unknown.size) {
    const st = await getState("cafe_unknown");
    const list = [...new Set([...(st.ids || []), ...unknown])].filter((k) => !learned[k]).slice(-300);
    await setState("cafe_unknown", { ids: list });
  }
}

// 이름 추가 (수집 도우미가 알아 온 이름 포함) → 이미 저장된 글 중 이름이 비어 있던 글도 채움
export async function addNames(names, fixPosts = true) {
  const clean = {};
  for (const [club, name] of Object.entries(names || {})) {
    const n = String(name || "").replace(/\s*:\s*네이버\s*카페$/, "").trim().slice(0, 60);
    if (ok(club) && n && n.toLowerCase() !== key(club)) clean[key(club)] = n;
  }
  if (!Object.keys(clean).length) return 0;
  await db.doc(BOOK).set({ names: clean, updatedAt: new Date() }, { merge: true });
  const st = await getState("cafe_unknown");
  if (st.ids?.length) await setState("cafe_unknown", { ids: st.ids.filter((k) => !clean[k]) });
  let fixed = 0;
  if (fixPosts) {
    for (const [club, name] of Object.entries(clean)) {
      const snap = await db.collection("posts").where("sourceId", "in", [club, club.toUpperCase(), Object.keys(names).find((c) => key(c) === club)].filter((v, i, a) => v && a.indexOf(v) === i)).limit(300).get();
      const w = db.batch();
      let n = 0;
      for (const d of snap.docs) {
        const s = String(d.data().source || "").trim();
        if (d.data().channel === "cafe" && (!s || s.toLowerCase() === club)) { w.update(d.ref, { source: name }); n++; }
      }
      if (n) { await w.commit(); fixed += n; }
    }
  }
  return fixed;
}

// 수집 도우미에게 이름을 알아 와 달라고 할 카페 (한 번에 몇 곳씩)
export async function unknownCafes(n = 8) {
  return ((await getState("cafe_unknown")).ids || []).slice(0, n);
}
