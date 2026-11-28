// 제목 유사도: 괄호 머리말·특수문자·띄어쓰기를 빼고 글자 2개씩 묶음(bigram)의 Dice 계수 (0~1)
export function normTitle(s) {
  return String(s || "")
    .replace(/\[[^\]]{0,20}\]|【[^】]{0,20}】|\([^)]{0,12}\)|<[^>]{0,12}>/g, " ")
    .replace(/(단독|속보|종합|포토|영상|사진|1보|2보|상보)/g, " ")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "");
}

function bigrams(s) {
  const m = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const b = s.slice(i, i + 2);
    m.set(b, (m.get(b) || 0) + 1);
  }
  return m;
}

export function similarity(a, b) {
  const x = normTitle(a);
  const y = normTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const A = bigrams(x);
  const B = bigrams(y);
  let inter = 0;
  for (const [k, v] of A) inter += Math.min(v, B.get(k) || 0);
  return (2 * inter) / (x.length - 1 + (y.length - 1));
}

// 목록에서 가장 비슷한 것 (기준 이상일 때만)
export function findSimilar(title, list, threshold, getTitle = (x) => x.t) {
  let best = null;
  let bestScore = threshold;
  for (const it of list) {
    const s = similarity(title, getTitle(it));
    if (s >= bestScore) {
      best = it;
      bestScore = s;
    }
  }
  return best ? { item: best, score: bestScore } : null;
}
