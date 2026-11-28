// 규칙 기반 기본 성향: pos(긍정) / neu(중립) / neg(부정) / abuse(단순비난)
import { norm, parseRules, matchRules } from "./keywords.js";

export function compileLexicon(lex = {}) {
  return {
    abuse: parseRules(lex.abuse),
    negative: parseRules(lex.negative),
    positive: parseRules(lex.positive),
  };
}

export function ruleSentiment(text, lex) {
  const t = norm(text);
  const a = matchRules(t, lex.abuse).length;
  const n = matchRules(t, lex.negative).length;
  const p = matchRules(t, lex.positive).length;
  // 구체적인 문제(부정어) 없이 욕·비아냥만 있으면 단순비난
  if (a > 0 && n === 0) return "abuse";
  if (n + a > p) return "neg";
  if (p > n + a) return "pos";
  return "neu";
}
