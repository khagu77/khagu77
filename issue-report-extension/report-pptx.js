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

const pct = (x) => `${(Math.round(x * 1000) / 10).toFixed(1)}%`;
const numFmt = (n) => Number(n || 0).toLocaleString("en-US");

// 인용 댓글을 글자 수 한도 안에서 ‘…’, ‘…’ 로 잇는다
function joinQuotes(list, budget, maxEach = 150) {
  const out = [];
  let len = 0;
  for (const raw of list) {
    let t = String(raw || "").replace(/\s+/g, " ").replace(/[‘’]/g, "'").trim();
    if (!t) continue;
    if (t.length > maxEach) t = `${t.slice(0, maxEach - 1)}…`;
    const piece = `‘${t}’`;
    if (out.length && len + piece.length + 2 > budget) break;
    out.push(piece);
    len += piece.length + 2;
  }
  return out.join(", ");
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
  s1 = replaceShape(s1, "직사각형 31", (x) => setParagraphs(x, (data.summary.length ? data.summary : [""]).slice(0, 3).map((t) => ` ${t}`)));

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
  s1 = replaceShape(s1, "표 17", (x) =>
    mapTableRows(x, (i, cells) => {
      if (i === 0) return null;
      const s = SENTIMENTS[i - 1];
      const text = joinQuotes(data.short[s] || [], 230, 90) || "-";
      return { cells: cells.map((c, j) => (j === 1 ? setParagraphs(c, [pct(rate(all, s))]) : j === 2 ? setParagraphs(c, [text]) : c)) };
    }),
  );
  files.set("ppt/slides/slide1.xml", s1);

  // 차트 값 (가로 100% 누적 막대)
  const chartVals = SENTIMENTS.map((s) => CHART_CATS.map((cat) => rate(data.stats[cat === "전 채널" ? "전체" : cat], s)));
  let chart = Zip.text(files.get("ppt/charts/chart1.xml"));
  let si = -1;
  chart = chart.replace(/<c:val>(.*?)<\/c:val>/gs, (all2, inner) => {
    si++;
    const vals = chartVals[si] || [];
    return `<c:val>${inner.replace(/<c:pt idx="(\d+)"><c:v>[^<]*<\/c:v><\/c:pt>/g, (_, k) => `<c:pt idx="${k}"><c:v>${Math.round((vals[+k] || 0) * 1000) / 1000}</c:v></c:pt>`)}</c:val>`;
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
  const have = SENTIMENTS.map((s) => (data.long[s] || []).reduce((n, t) => n + String(t).length + 4, 0));
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
  const texts = SENTIMENTS.map((s, k) => joinQuotes(data.long[s] || [], budgets[k]) || "-");
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
