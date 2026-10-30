// 미리보기 카드 선택 학습 (담당자 요청 2026-10-30)
// 담당자가 미리보기 카드에서 댓글·사진 체크를 바꾸면 그 선택을 기억해 다음 작성부터 반영한다.
//  - 댓글: 'AI 가 고른 댓글 → 담당자가 고른 댓글' 사례를 AI 프롬프트에 붙여 비슷한 댓글을 고르게 한다
//  - 사진: AI 는 그림을 보지 못하므로 종류(동영상·작은 이미지·가로 배너형·세로로 긴 이미지·일반 사진)별로
//          담당자가 뺀/넣은 횟수와 최종 사진 수를 모아, 처음 체크해 두는 사진을 담당자 습관대로 고른다
// 저장: 이 PC 크롬 chrome.storage.local "pptPickLearned" (글마다 한 줄, 같은 글은 마지막 선택으로 덮어씀)
(function (global) {
  const KEY = "pptPickLearned";
  const MAX = 150;
  const PROMPT_MAX = 15;
  const TYPE_LABEL = { video: "동영상", small: "작은 이미지", banner: "가로 배너형 이미지", tall: "세로로 긴 이미지(화면 캡처 등)", photo: "일반 사진" };
  let list = [];

  async function load() {
    const r = await chrome.storage.local.get(KEY).catch(() => ({}));
    list = Array.isArray(r[KEY]) ? r[KEY] : [];
    return list;
  }
  async function save(next) {
    list = next.slice(0, MAX);
    await chrome.storage.local.set({ [KEY]: list, pptLearnedUpdatedAt: Date.now() });
  }

  // 사진 종류 (캡처 때 읽은 화면 크기 기준)
  function imageType(m) {
    if (!m) return "photo";
    if (m.video) return "video";
    const w = Number(m.width) || 0;
    const h = Number(m.height) || 0;
    if (w && h && Math.max(w, h) < 200) return "small";
    if (w && h && w / h >= 2.5) return "banner";
    if (w && h && h / w >= 2.2) return "tall";
    return "photo";
  }

  const clip = (t, n = 60) => {
    const s = String(t || "").replace(/\s+/g, " ").trim();
    return s.length > n ? `${s.slice(0, n)}…` : s;
  };

  // 글 하나의 최종 선택을 기록 (ai: 처음 선택, sel: 지금 선택, info: 캡처 정보)
  async function record({ key, cafe, car, title, info, ai, sel }) {
    if (!key || !ai || !sel) return;
    const comments = (info && info.comments) || [];
    const images = (info && info.images) || [];
    const ct = (idx) => clip((comments.find((c) => c.index === idx) || {}).text);
    const aiC = [...ai.comments].sort((a, b) => a - b);
    const myC = [...sel.comments].sort((a, b) => a - b);
    const aiI = new Set(ai.images);
    const myI = new Set(sel.images);
    const removed = [...aiI].filter((i) => !myI.has(i)).map((i) => imageType(images[i]));
    const added = [...myI].filter((i) => !aiI.has(i)).map((i) => imageType(images[i]));
    const commentChanged = aiC.join(",") !== myC.join(",");
    const imageChanged = removed.length > 0 || added.length > 0;
    const rest = (await load()).filter((x) => x.key !== key);
    if (!commentChanged && !imageChanged) {
      if (rest.length !== list.length) await save(rest); // 원래대로 돌려 놓으면 사례도 지운다
      return;
    }
    rest.unshift({
      key,
      at: Date.now(),
      cafe: cafe || "",
      car: car || "",
      title: clip(title, 50),
      comments: commentChanged ? { ai: aiC.map(ct).filter(Boolean), mine: myC.map(ct).filter(Boolean) } : null,
      images: imageChanged ? { removed, added, count: myI.size, total: images.length } : null,
    });
    await save(rest);
  }

  // AI 프롬프트에 붙일 댓글 선택 사례
  function commentSection() {
    const lines = list
      .filter((x) => x.comments && (x.comments.ai.length || x.comments.mine.length))
      .slice(0, PROMPT_MAX)
      .map((x) => `- [${x.car || "-"}] AI 가 고른 댓글 ${x.comments.ai.map((t) => `"${t}"`).join(", ") || "(없음)"} → 담당자가 고른 댓글 ${x.comments.mine.map((t) => `"${t}"`).join(", ") || "(댓글 캡처 안 넣음)"}`);
    if (!lines.length) return "";
    return `\n\n[담당자 댓글 선택 사례 (자동 학습, 최근 순)]\n담당자가 미리보기에서 캡처할 댓글을 바꾼 기록입니다. 왜 바꿨는지(더 자극적·구체적인 댓글, 같은 증상을 겪었다는 댓글, 짧은 댓글, 작성자 본인 댓글 제외 등)를 스스로 헤아려 comment_picks 를 담당자 쪽처럼 고릅니다.\n${lines.join("\n")}`;
  }

  // 사진 종류별 습관: 담당자가 자주 빼는 종류, 즐겨 쓰는 사진 수
  function imageHabit() {
    const stat = {};
    const counts = [];
    for (const x of list) {
      if (!x.images) continue;
      for (const t of x.images.removed) (stat[t] = stat[t] || { removed: 0, added: 0 }).removed++;
      for (const t of x.images.added) (stat[t] = stat[t] || { removed: 0, added: 0 }).added++;
      if (x.images.total > x.images.count || x.images.count > 0) counts.push(x.images.count);
    }
    // 3번 이상 뺐고, 넣은 것보다 2배 넘게 많이 뺀 종류는 처음부터 체크하지 않는다
    const skip = Object.keys(stat).filter((t) => stat[t].removed >= 3 && stat[t].removed > stat[t].added * 2);
    // 사진 수: 고친 글이 3건 이상이면 최근 10건의 가운데 값 (1~8장)
    let count = null;
    const recent = counts.slice(0, 10).sort((a, b) => a - b);
    if (recent.length >= 3) count = Math.min(8, Math.max(1, recent[Math.floor(recent.length / 2)]));
    return { skip, count, stat };
  }

  // 처음 체크해 둘 사진 번호 (기본 n장, 담당자 습관 반영)
  function defaultImages(visualImages, infoImages, n) {
    const { skip, count } = imageHabit();
    const want = count || n;
    const idx = visualImages.map((_, i) => i).filter((i) => visualImages[i]);
    const preferred = idx.filter((i) => !skip.includes(imageType((infoImages || [])[i])));
    // 빼는 종류만 있는 글이면 그래도 앞에서부터 (사진이 하나도 안 들어가는 일은 없게)
    return (preferred.length ? preferred : idx).slice(0, want);
  }

  function summary() {
    const c = list.filter((x) => x.comments).length;
    const { skip, count } = imageHabit();
    return { comments: c, images: list.filter((x) => x.images).length, skip: skip.map((t) => TYPE_LABEL[t] || t), count };
  }

  global.PickLearn = { load, record, commentSection, defaultImages, imageType, summary, TYPE_LABEL };
})(typeof window !== "undefined" ? window : self);
