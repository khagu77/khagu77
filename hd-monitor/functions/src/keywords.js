// 키워드 규칙 해석·매칭
// 문법: '+' ',' 줄바꿈 = OR / '*' = AND / '#숫자'(기존 시스템 표기)는 무시 / 비교할 때 띄어쓰기·대소문자 무시

export const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");

export function parseRules(text) {
  const seen = new Set();
  const out = [];
  for (const piece of String(text || "").split(/[+,\n]/)) {
    const raw = piece.replace(/#\d+/g, "").trim();
    if (!raw) continue;
    const all = raw.split("*").map(norm).filter(Boolean);
    if (!all.length) continue;
    const key = all.join("*");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ raw, all, query: raw.split("*").map((s) => s.trim()).filter(Boolean).join(" ") });
  }
  return out;
}

export const ruleHit = (t, r) => r.all.every((w) => t.includes(w));
export const matchRules = (t, rules) => rules.filter((r) => ruleHit(t, r)).map((r) => r.raw);

// 설정의 키워드 그룹을 한 번만 해석해 둔다
export function compileGroups(settings) {
  const groups = (settings.keywordGroups || []).map((g) => ({ ...g, parsed: parseRules(g.rules) }));
  const target = groups.filter((g) => g.role === "target").flatMap((g) => g.parsed);
  const exclude = groups.filter((g) => g.role === "exclude").flatMap((g) => g.parsed);
  return { groups, target, exclude };
}

// 수집 검색어 목록 (collect 가 켜진 그룹의 규칙, 중복 제거)
export function collectQueries(compiled) {
  const seen = new Set();
  const out = [];
  for (const g of compiled.groups) {
    if (!g.collect || g.role === "exclude") continue;
    for (const r of g.parsed) {
      const k = r.all.join(" ");
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r.query);
    }
  }
  return out;
}
