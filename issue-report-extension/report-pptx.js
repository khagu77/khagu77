// PPT 보고서: 담당자가 준 'CN8 가격 공개 관련 여론 동향' PPT 를 양식(templates/report-template.pptx)으로 그대로 쓰고,
// 글자·숫자·차트 값만 바꿔 넣는다. 각 글상자·표 칸의 첫 글자 서식(서체·크기·굵기·색)을 그대로 이어 받으므로 양식과 모양이 같다.

const CHANNEL_ROWS = ["언론", "동호회", "커뮤니티", "유튜브"]; // 1페이지 표 순서
const CHART_CATS = ["유튜브", "커뮤니티", "동호회", "언론", "전 채널"]; // 차트(가로 막대) 아래→위 순서

// 도형 하나(<p:sp> 또는 <p:graphicFrame>)의 위치: name="…" 로 찾는다
function shapeRange(xml, name) {
  const at = xml.indexOf(`name="${name}"`);
  if (at < 0) throw new Error(`PPT 양식에서 '${name}' 도형을 찾지 못했습니다`);
  const starts = [xml.lastIndexOf("<p:sp>", at), xml.lastIndexOf("<p:graphicFrame>", at)];
  const start = Math.max(...starts);
  const tag = start === starts[0] ? "</p:sp>" : "</p:graphicFrame>";
  const end = xml.indexOf(tag, at) + tag.length;
  return [start, end];
}

function replaceShape(xml, name, fn) {
  const [s, e] = shapeRange(xml, name);
  return xml.slice(0, s) + fn(xml.slice(s, e)) + xml.slice(e);
}

const runsOf = (p) => [...p.matchAll(/<a:r>(.*?)<\/a:r>/gs)].map((m) => m[1]);
const rPrOf = (run) => (run.match(/<a:rPr[^>]*\/>|<a:rPr[^>]*>.*?<\/a:rPr>/s) || [""])[0];

function runXml(rPr, text) {
  return `<a:r>${rPr}<a:t>${escapeXml(text)}</a:t></a:r>`;
}

// 문단 하나를 같은 서식으로 다시 쓰기. parts: [[원본 글자 조각 번호, 글자], …] — 그 조각의 서식을 빌려 쓴다
function rewriteParagraph(p, parts) {
  const runs = runsOf(p);
  const pPr = (p.match(/<a:pPr[^>]*\/>|<a:pPr[^>]*>.*?<\/a:pPr>/s) || [""])[0];
  const end = (p.match(/<a:endParaRPr[^>]*\/>|<a:endParaRPr[^>]*>.*?<\/a:endParaRPr>/s) || [""])[0];
  const body = parts.map(([i, t]) => runXml(rPrOf(runs[Math.min(i, runs.length - 1)] || ""), t)).join("");
  return `<a:p>${pPr}${body}${end}</a:p>`;
}

// 글상자(또는 표 칸)의 문단들을 새 글로: 문단마다 원본의 같은 순번 문단(없으면 첫 문단) 서식을 따른다
function setParagraphs(xml, texts) {
  // 도형 글상자는 <p:txBody>, 표 칸은 <a:txBody>
  const m = xml.match(/<([ap]):txBody>(.*?)<\/\1:txBody>/s);
  if (!m) return xml;
  const paras = m[2].match(/<a:p>.*?<\/a:p>|<a:p\/>/gs) || [];
  const before = paras.length ? m[2].slice(0, m[2].indexOf(paras[0])) : m[2];
  const ps = texts.map((t, i) => {
    const tp = paras[Math.min(i, paras.length - 1)] || "<a:p></a:p>";
    return rewriteParagraph(tp, Array.isArray(t) ? t : [[0, t]]);
  });
  return xml.replace(m[0], `<${m[1]}:txBody>${before}${ps.join("")}</${m[1]}:txBody>`);
}

// 표: 행(<a:tr>)·칸(<a:tc>) 단위로 바꾸기
function mapTableRows(xml, fn) {
  let i = -1;
  return xml.replace(/<a:tr h="(\d+)">(.*?)<\/a:tr>/gs, (all, h, inner) => {
    i++;
    let j = -1;
    const cells = [];
    const out = inner.replace(/<a:tc(?: [^>]*)?>.*?<\/a:tc>/gs, (tc) => {
      j++;
      cells.push(tc);
      return `@@TC${j}@@`;
    });
    const res = fn(i, cells, +h) || {};
    const newCells = res.cells || cells;
    return `<a:tr h="${res.height || h}">${out.replace(/@@TC(\d+)@@/g, (_, k) => newCells[+k])}</a:tr>`;
  });
}

// 글자 폭 대강 (한글 1, 영문·숫자·기호 0.55) — 요약 줄 수 어림용. 14pt 굵은 글씨로 한 줄 ≈ 폭 70 (보낸 화면 기준)
const SUMMARY_LINE = 70;
function textWidth(t) {
  let w = 0;
  for (const ch of String(t)) w += /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF\u4E00-\u9FFF\u3000-\u303F]/.test(ch) ? 1 : 0.55;
  return w;
}

const pct = (x) => `${(Math.round(x * 1000) / 10).toFixed(1)}%`;
const numFmt = (n) => Number(n || 0).toLocaleString("en-US");

// 인용 댓글을 글자 수 한도 안에서 ‘…’, ‘…’ 로 잇는다
function joinQuotes(list, budget, maxEach = 150) {
  return fitQuotes(list, budget, maxEach).text;
}

// PPT 서체에 없는 이모지 등은 까만 네모로 보이므로 뺀다
function pptSafe(text) {
  return String(text || "")
    .replace(/[\p{Extended_Pictographic}\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{E000}-\u{F8FF}\uFE00-\uFE0F\u200B-\u200D\u2060\u20E3\uFFFD]/gu, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 칸에 들어갈 만큼 → { text, used: 실제로 들어간 댓글 }
function fitQuotes(list, budget, maxEach = 150) {
  const out = [];
  const used = [];
  let len = 0;
  for (const raw of list) {
    let t = pptSafe(stripMentions(raw)).replace(/[‘’]/g, "'");
    if (!t) continue;
    const chars = Array.from(t);
    if (chars.length > maxEach) t = `${chars.slice(0, maxEach - 1).join("")}…`;
    const piece = `‘${t}’`;
    if (out.length && len + piece.length + 2 > budget) break;
    out.push(piece);
    used.push(raw);
    len += piece.length + 2;
  }
  return { text: out.join(", "), used };
}

// 1페이지에 실제로 들어간 댓글은 2페이지에서 뺀다 (두 페이지에 같은 댓글이 겹치지 않게)
const quoteKey = (t) => String(t || "").replace(/[\s‘’'"“”]/g, "");
function withoutQuotes(list, shown) {
  const keys = new Set((shown || []).map(quoteKey));
  return (list || []).filter((t) => !keys.has(quoteKey(t)));
}

// 1페이지 머리 문장의 판단 표현 (부정·긍정 비율로)
function headlinePhrase(neg, pos) {
  const hi = Math.max(neg, pos);
  const lo = Math.min(neg, pos);
  if (hi - lo < 0.03) return "비슷한 수준";
  if (hi >= lo * 5 || hi - lo >= 0.4) return "압도적으로 높은 편";
  if (hi >= lo * 2) return "높은 편";
  return "다소 높은 편";
}

const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
const hm = (d) => `${pad2(d.getHours())}시 ${pad2(d.getMinutes())}분`;

// data: {
//   title, summary: [두 문장], headline(판단 표현, 비우면 자동),
//   from, to, channelsLabel,
//   stats: { 전체|언론|동호회|커뮤니티|유튜브: { posts, comments, 긍정, 중립, 부정, 단순비난 (건수) } },
//   short: { 긍정: [댓글…], … }, long: { 긍정: [댓글…], … }
// }
async function buildReportPptx(data) {
  const files = await loadTemplate("templates/report-template.pptx");
  const rate = (st, s) => (st && st.comments ? (st[s] || 0) / st.comments : 0);
  const all = data.stats["전체"] || { posts: 0, comments: 0 };
  const negAll = rate(all, "부정") + rate(all, "단순비난");
  const posAll = rate(all, "긍정");

  // ---------------- 1페이지 ----------------
  let s1 = Zip.text(files.get("ppt/slides/slide1.xml"));
  const titleParts = [[0, " ■"], [1, ` ${data.title}`]];
  s1 = replaceShape(s1, "제목 9", (x) => setParagraphs(x, [titleParts]));

  const from = new Date(data.from);
  const to = new Date(data.to);
  s1 = replaceShape(s1, "직사각형 25", (x) =>
    setParagraphs(x, [`모니터링 기간 : ${md(from)} ${hm(from)} ~ ${md(to)} ${hm(to)}`, `모니터링 채널 : ${data.channelsLabel}`]),
  );
  // 요약: 글상자에 3줄까지 들어감 → 넘치면 글자 크기를 줄여 표를 덮지 않게
  const sumLines = (data.summary.length ? data.summary : [""]).slice(0, 3).map((t) => ` ${pptSafe(t)}`);
  s1 = replaceShape(s1, "직사각형 31", (x) => {
    x = setParagraphs(x, sumLines);
    const lines = sumLines.reduce((n, t) => n + Math.max(1, Math.ceil(textWidth(t) / SUMMARY_LINE)), 0);
    if (lines <= 3) return x;
    const sz = Math.max(1000, Math.floor((1400 * 3) / lines / 50) * 50);
    return x.replace(/(<a:(?:rPr|endParaRPr)[^>]*?) sz="\d+"/g, `$1 sz="${sz}"`);
  });

  const phrase = data.headline || headlinePhrase(negAll, posAll);
  const headParts =
    negAll >= posAll
      ? [[0, "부정 여론"], [1, "(부정+단순비난)"], [6, `이 긍정 여론 比 ${phrase} `], [10, "("], [11, pct(negAll)], [12, " vs "], [13, pct(posAll)], [14, ")"]]
      : [[0, "긍정 여론"], [6, "이 부정 여론"], [1, "(부정+단순비난)"], [6, ` 比 ${phrase} `], [10, "("], [13, pct(posAll)], [12, " vs "], [11, pct(negAll)], [14, ")"]];
  s1 = replaceShape(s1, "직사각형 21", (x) => setParagraphs(x, [headParts]));

  // 채널별 표
  s1 = replaceShape(s1, "표 15", (x) =>
    mapTableRows(x, (i, cells) => {
      if (i === 0) return null;
      const name = i === 1 ? "전체" : CHANNEL_ROWS[i - 2];
      const st = data.stats[name];
      const vals = st && st.posts ? [numFmt(st.posts), numFmt(st.comments), ...SENTIMENTS.map((s) => (st.comments ? pct(rate(st, s)) : "-"))] : ["-", "-", "-", "-", "-", "-"];
      return { cells: cells.map((c, j) => (j >= 2 ? setParagraphs(c, [vals[j - 2]]) : c)) };
    }),
  );

  // 성향별 주요 내용 (짧은 인용)
  const page1Shown = {};
  s1 = replaceShape(s1, "표 17", (x) =>
    mapTableRows(x, (i, cells) => {
      if (i === 0) return null;
      const s = SENTIMENTS[i - 1];
      const fit = fitQuotes(data.short[s] || [], 230, 90);
      page1Shown[s] = fit.used;
      const text = fit.text || "-";
      return { cells: cells.map((c, j) => (j === 1 ? setParagraphs(c, [pct(rate(all, s))]) : j === 2 ? setParagraphs(c, [text]) : c)) };
    }),
  );
  files.set("ppt/slides/slide1.xml", s1);

  // 차트 값 (가로 100% 누적 막대)
  const chartVals = SENTIMENTS.map((s) => CHART_CATS.map((cat) => rate(data.stats[cat === "전 채널" ? "전체" : cat], s)));
  let chart = Zip.text(files.get("ppt/charts/chart1.xml"));
  // 양식의 긍정 계열엔 수치 표시가 없어 → 다른 계열의 수치 표시 서식을 빌려 넣는다
  const lblTpl = (chart.match(/<c:dLbls>.*?<\/c:dLbls>/s) || [""])[0];
  let si = -1;
  chart = chart.replace(/<c:ser>.*?<\/c:ser>/gs, (ser) => {
    si++;
    const vals = chartVals[si] || [];
    ser = ser.replace(/<c:val>(.*?)<\/c:val>/s, (all2, inner) => `<c:val>${inner.replace(/<c:pt idx="(\d+)"><c:v>[^<]*<\/c:v><\/c:pt>/g, (_, k) => `<c:pt idx="${k}"><c:v>${Math.round((vals[+k] || 0) * 1000) / 1000}</c:v></c:pt>`)}</c:val>`);
    if (!/<c:dLbls>/.test(ser) && lblTpl) ser = ser.replace(/(<c:invertIfNegative[^>]*\/>)/, `$1${lblTpl}`);
    // 막대가 너무 짧은(5% 미만) 칸은 수치가 삐져나오므로 숨김
    const hide = vals.map((v, k) => (v > 0 && v < 0.05) || !v ? `<c:dLbl><c:idx val="${k}"/><c:delete val="1"/><c:extLst><c:ext uri="{CE6537A1-D6FC-4f65-9D91-7224C49458BB}" xmlns:c15="http://schemas.microsoft.com/office/drawing/2012/chart"/></c:extLst></c:dLbl>` : "").join("");
    return ser.replace(/<c:dLbls>(?:<c:dLbl>.*?<\/c:dLbl>)*/s, `<c:dLbls>${hide}`);
  });
  files.set("ppt/charts/chart1.xml", chart);
  // 차트 원본 데이터(PPT 에서 '데이터 편집' 했을 때 보이는 엑셀)도 같은 값으로
  const embName = [...files.keys()].find((k) => /^ppt\/embeddings\/.*\.xlsx$/.test(k));
  if (embName) {
    const emb = await Zip.read(files.get(embName));
    let sh = Zip.text(emb.get("xl/worksheets/sheet1.xml"));
    const cols = ["B", "C", "D", "E"];
    sh = sh.replace(/<c r="([B-E])([2-6])"([^>]*)><v>[^<]*<\/v><\/c>/g, (all3, col, row, attrs) => {
      const v = chartVals[cols.indexOf(col)][+row - 2];
      return `<c r="${col}${row}"${attrs}><v>${Math.round((v || 0) * 1000) / 1000}</v></c>`;
    });
    emb.set("xl/worksheets/sheet1.xml", sh);
    files.set(embName, await Zip.write(emb));
  }

  // ---------------- 2페이지 ----------------
  let s2 = Zip.text(files.get("ppt/slides/slide2.xml"));
  s2 = replaceShape(s2, "제목 9", (x) => setParagraphs(x, [titleParts]));
  // 줄 높이는 글자 양에 맞춰 나누되 표 전체 높이는 양식과 같게
  const TOTAL_CHARS = 2700;
  const long = Object.fromEntries(SENTIMENTS.map((s) => [s, withoutQuotes(data.long[s], page1Shown[s])]));
  const have = SENTIMENTS.map((s) => (long[s] || []).reduce((n, t) => n + String(t).length + 4, 0));
  const budgets = SENTIMENTS.map((s, k) => Math.min(have[k], Math.max(260, Math.round(TOTAL_CHARS / 4))));
  let spare = TOTAL_CHARS - budgets.reduce((a, b) => a + b, 0);
  for (let pass = 0; pass < 3 && spare > 20; pass++) {
    const hungry = SENTIMENTS.map((_, k) => k).filter((k) => have[k] > budgets[k]);
    if (!hungry.length) break;
    const add = Math.floor(spare / hungry.length);
    for (const k of hungry) {
      const take = Math.min(add, have[k] - budgets[k]);
      budgets[k] += take;
      spare -= take;
    }
  }
  const texts = SENTIMENTS.map((s, k) => joinQuotes(long[s] || [], budgets[k]) || "-");
  s2 = replaceShape(s2, "표 16", (x) => {
    let bodyTotal = 0;
    x.replace(/<a:tr h="(\d+)">/g, (_, h) => (bodyTotal += +h));
    const headH = +(x.match(/<a:tr h="(\d+)">/) || [0, 255664])[1];
    bodyTotal -= headH;
    const weights = texts.map((t) => Math.max(t.length, 420));
    const wsum = weights.reduce((a, b) => a + b, 0);
    return mapTableRows(x, (i, cells) => {
      if (i === 0) return null;
      const s = SENTIMENTS[i - 1];
      return {
        height: Math.round((bodyTotal * weights[i - 1]) / wsum),
        cells: cells.map((c, j) => (j === 0 ? setParagraphs(c, [s, `(${pct(rate(all, s))})`]) : setParagraphs(c, [texts[i - 1]]))),
      };
    });
  });
  files.set("ppt/slides/slide2.xml", s2);

  // 미리보기 그림(양식의 예전 내용)은 빼고, 문서 정보 정리
  if (files.has("docProps/thumbnail.jpeg")) {
    files.delete("docProps/thumbnail.jpeg");
    files.set("_rels/.rels", Zip.text(files.get("_rels/.rels")).replace(/<Relationship [^>]*thumbnail[^>]*\/>/, ""));
  }
  let core = Zip.text(files.get("docProps/core.xml"));
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  core = core
    .replace(/<dc:title>.*?<\/dc:title>/, `<dc:title>${escapeXml(data.title)}</dc:title>`)
    .replace(/<cp:lastModifiedBy>.*?<\/cp:lastModifiedBy>/, "<cp:lastModifiedBy></cp:lastModifiedBy>")
    .replace(/(<dcterms:modified[^>]*>).*?(<\/dcterms:modified>)/, `$1${now}$2`);
  files.set("docProps/core.xml", core);
  return Zip.write(files);
}
