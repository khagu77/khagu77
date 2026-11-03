// 보고서 PPT 의 '차종별 긍정·부정 주요 내용 TOP5' 슬라이드(첨부 양식 3p)를 채운다.
// 회사 보고서 양식은 공개 저장소에 넣지 않으므로, 화면에서 사용자가 고른 보고서 PPT 파일을 그대로 틀로 쓴다.
//
//  - '순위 · 내용 · 개수 · 비율' 머리글 표가 있는 슬라이드를 찾는다.
//  - 차종 이름 상자(아반떼 · 그랜저 · 싼타페)마다 한 줄: 왼쪽 표는 '긍정', 오른쪽 표는 '부정' 머리 띠 아래 표.
//    표가 첫 줄(아반떼)에만 있으면 머리 띠와 표를 복제해 다른 차종 줄에 같은 간격으로 놓는다.
//  - 표의 1~5위 줄에 내용 · 개수 · 비율을 쓴다 (모자라면 빈칸, 양식의 '예시)' 글은 지움).
//  - 제목을 바꾸고, 원하면 나머지 슬라이드는 뺀다(쓰지 않게 된 차트·노트 등은 함께 지움).
//
// PptFill.fill(bytes, { cars: { 아반떼: { pos: [{ label, count, ratio }], neg: [...] }, ... }, title, onlyThis, report })
//   → Promise<{ bytes, filled }>  (report 를 주면 1·2페이지도 채움 - fillReportSlides)
(function (global) {
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const PR = "http://schemas.openxmlformats.org/package/2006/relationships";
  const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
  const T_SLIDE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";

  const parse = (s) => new DOMParser().parseFromString(typeof s === "string" ? s : Zip.text(s), "application/xml");
  const ser = (d) => new XMLSerializer().serializeToString(d);
  const kids = (el, ns, name) => [...el.childNodes].filter((n) => n.namespaceURI === ns && n.localName === name);
  const all = (el, ns, name) => [...el.getElementsByTagNameNS(ns, name)];
  const relsPath = (part) => part.replace(/([^/]+)$/, "_rels/$1.rels");
  const resolve = (base, target) => {
    if (target.startsWith("/")) return target.slice(1);
    const parts = base.split("/").slice(0, -1);
    for (const seg of target.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg !== ".") parts.push(seg);
    }
    return parts.join("/");
  };
  const textOf = (el) => all(el, A, "t").map((t) => t.textContent).join("").replace(/\s+/g, " ").trim();

  // 도형 위치 (EMU): p:sp → p:spPr/a:xfrm · p:graphicFrame → p:xfrm
  function xfrmOf(shape) {
    const x = shape.localName === "graphicFrame" ? kids(shape, P, "xfrm")[0] : all(shape, A, "xfrm")[0];
    if (!x) return null;
    const off = kids(x, A, "off")[0];
    const ext = kids(x, A, "ext")[0];
    if (!off || !ext) return null;
    return { off, x: Number(off.getAttribute("x")), y: Number(off.getAttribute("y")), w: Number(ext.getAttribute("cx")), h: Number(ext.getAttribute("cy")) };
  }

  function isRankTable(frame) {
    const tbl = all(frame, A, "tbl")[0];
    if (!tbl) return false;
    const first = kids(tbl, A, "tr")[0];
    const head = first ? kids(first, A, "tc").map(textOf) : [];
    return head.includes("순위") && head.includes("내용") && head.some((h) => /개수|건수/.test(h)) && head.includes("비율");
  }

  // 칸 글자 바꾸기: 첫 단락만 남기고, 첫 글자 묶음의 서식을 쓰되 기울임·글자색(양식의 '예시)' 파란 기울임)은 뺀다
  function setCell(tc, text, { plain = true } = {}) {
    const body = kids(tc, A, "txBody")[0];
    if (!body) return;
    const ps = kids(body, A, "p");
    const p = ps[0];
    for (const extra of ps.slice(1)) body.removeChild(extra);
    const doc = tc.ownerDocument;
    const r0 = kids(p, A, "r")[0];
    let rPr = r0 ? kids(r0, A, "rPr")[0]?.cloneNode(true) : null;
    if (!rPr) {
      rPr = doc.createElementNS(A, "a:rPr");
      const end = kids(p, A, "endParaRPr")[0];
      if (end) {
        for (const at of end.attributes) rPr.setAttribute(at.name, at.value);
        for (const c of end.childNodes) rPr.appendChild(c.cloneNode(true));
      }
    }
    rPr.setAttribute("lang", "ko-KR");
    rPr.removeAttribute("err");
    if (plain) {
      rPr.removeAttribute("i");
      for (const f of [...kids(rPr, A, "solidFill"), ...kids(rPr, A, "highlight")]) rPr.removeChild(f);
    }
    for (const n of [...p.childNodes]) if (n.namespaceURI === A && ["r", "br", "fld"].includes(n.localName)) p.removeChild(n);
    if (text !== "") {
      const r = doc.createElementNS(A, "a:r");
      r.appendChild(rPr);
      const t = doc.createElementNS(A, "a:t");
      t.textContent = text;
      r.appendChild(t);
      const end = kids(p, A, "endParaRPr")[0];
      if (end) p.insertBefore(r, end);
      else p.appendChild(r);
    }
  }

  // 표 채우기: 머리글(순위·내용·개수·비율) 열 위치대로, 1~5위 줄
  function fillTable(frame, rows) {
    const tbl = all(frame, A, "tbl")[0];
    const trs = kids(tbl, A, "tr");
    const head = kids(trs[0], A, "tc").map(textOf);
    const col = {
      rank: head.indexOf("순위"),
      label: head.indexOf("내용"),
      count: head.findIndex((h) => /개수|건수/.test(h)),
      ratio: head.indexOf("비율"),
    };
    trs.slice(1).forEach((tr, i) => {
      const tcs = kids(tr, A, "tc");
      const row = rows[i];
      if (col.label >= 0) setCell(tcs[col.label], row ? row.label : "");
      if (col.count >= 0) setCell(tcs[col.count], row ? `${row.count.toLocaleString()}건` : "");
      if (col.ratio >= 0) setCell(tcs[col.ratio], row ? `${(Math.round(row.ratio * 1000) / 10).toFixed(1)}%` : "");
    });
  }

  function setShapeText(sp, text) {
    const body = kids(sp, P, "txBody")[0];
    if (!body) return;
    const ps = kids(body, A, "p");
    for (const extra of ps.slice(1)) body.removeChild(extra);
    const p = ps[0];
    const r0 = kids(p, A, "r")[0];
    const doc = sp.ownerDocument;
    const r = r0 ? r0.cloneNode(true) : doc.createElementNS(A, "a:r");
    if (!kids(r, A, "t")[0]) r.appendChild(doc.createElementNS(A, "a:t"));
    kids(r, A, "t")[0].textContent = text;
    for (const n of [...p.childNodes]) if (n.namespaceURI === A && ["r", "br", "fld"].includes(n.localName)) p.removeChild(n);
    const end = kids(p, A, "endParaRPr")[0];
    if (end) p.insertBefore(r, end);
    else p.appendChild(r);
  }

  // 슬라이드 목록 (발표 순서) → [{ part, rid, sldId }]
  function slideList(files, pres) {
    const rels = parse(files.get("ppt/_rels/presentation.xml.rels"));
    const byId = new Map(all(rels, PR, "Relationship").map((r) => [r.getAttribute("Id"), r]));
    return all(pres, P, "sldId").map((s) => {
      const rid = s.getAttributeNS(R, "id");
      return { sldId: s, rid, part: resolve("ppt/presentation.xml", byId.get(rid).getAttribute("Target")) };
    });
  }

  // 쓰지 않게 된 부분(뺀 슬라이드와 거기에만 딸린 차트·노트·그림 등)을 지운다
  function dropUnreachable(files) {
    const keep = new Set(["[Content_Types].xml"]);
    const queue = ["_rels/.rels"];
    keep.add("_rels/.rels");
    while (queue.length) {
      const relPart = queue.shift();
      const owner = relPart === "_rels/.rels" ? "" : relPart.replace(/_rels\/([^/]+)\.rels$/, "$1");
      const xml = files.get(relPart);
      if (!xml) continue;
      for (const r of all(parse(xml), PR, "Relationship")) {
        if (r.getAttribute("TargetMode") === "External") continue;
        const target = owner ? resolve(owner, r.getAttribute("Target")) : r.getAttribute("Target").replace(/^\//, "");
        if (keep.has(target) || !files.has(target)) continue;
        keep.add(target);
        const rp = relsPath(target);
        if (files.has(rp)) {
          keep.add(rp);
          queue.push(rp);
        }
      }
    }
    for (const name of [...files.keys()]) if (!keep.has(name)) files.delete(name);
    const ct = parse(files.get("[Content_Types].xml"));
    for (const o of all(ct, CT, "Override")) {
      if (!files.has(o.getAttribute("PartName").replace(/^\//, ""))) o.parentNode.removeChild(o);
    }
    files.set("[Content_Types].xml", Zip.bytes(ser(ct)));
  }


  // ======================================================================
  // 1·2페이지 (이슈 모니터링 보고서 작성 프로그램의 report-pptx.js 를 차종 줄로 바꿔 가져온 것)
  //  1p: 제목 · 모니터링 기간/채널 · 2줄 요약 · 머리 문장(부정 vs 긍정) · 차종별 표 · 100% 누적 막대 차트 · 성향별 주요 내용(짧은 인용)
  //  2p: 성향별 주요 댓글 여론(긴 인용, 1p 에 쓴 댓글은 빼고)
  // 도형은 양식의 이름(제목 9 · 직사각형 25/31/21 · 표 15/17/16 · 차트)으로 찾는다
  // ======================================================================
  const SENTI = ["긍정", "중립", "부정", "단순비난"];
  const xesc = (t) => String(t ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function shapeRange(xml, name) {
    const at = xml.indexOf(`name="${name}"`);
    if (at < 0) return null;
    const starts = [xml.lastIndexOf("<p:sp>", at), xml.lastIndexOf("<p:graphicFrame>", at)];
    const start = Math.max(...starts);
    const tag = start === starts[0] ? "</p:sp>" : "</p:graphicFrame>";
    return [start, xml.indexOf(tag, at) + tag.length];
  }
  function replaceShape(xml, name, fn) {
    const r = shapeRange(xml, name);
    if (!r) return xml;
    return xml.slice(0, r[0]) + fn(xml.slice(r[0], r[1])) + xml.slice(r[1]);
  }
  const runsOf = (p) => [...p.matchAll(/<a:r>(.*?)<\/a:r>/gs)].map((m) => m[1]);
  const rPrOf = (run) => (run.match(/<a:rPr[^>]*\/>|<a:rPr[^>]*>.*?<\/a:rPr>/s) || [""])[0];
  function rewriteParagraph(p, parts) {
    const runs = runsOf(p);
    const pPr = (p.match(/<a:pPr[^>]*\/>|<a:pPr[^>]*>.*?<\/a:pPr>/s) || [""])[0];
    const end = (p.match(/<a:endParaRPr[^>]*\/>|<a:endParaRPr[^>]*>.*?<\/a:endParaRPr>/s) || [""])[0];
    const body = parts.map(([i, t]) => `<a:r>${rPrOf(runs[Math.min(i, runs.length - 1)] || "")}<a:t>${xesc(t)}</a:t></a:r>`).join("");
    return `<a:p>${pPr}${body}${end}</a:p>`;
  }
  function setParagraphs(xml, texts) {
    const m = xml.match(/<([ap]):txBody>(.*?)<\/\1:txBody>/s);
    if (!m) return xml;
    const paras = m[2].match(/<a:p>.*?<\/a:p>|<a:p\/>/gs) || [];
    const before = paras.length ? m[2].slice(0, m[2].indexOf(paras[0])) : m[2];
    const ps = texts.map((t, i) => rewriteParagraph(paras[Math.min(i, paras.length - 1)] || "<a:p></a:p>", Array.isArray(t) ? t : [[0, t]]));
    return xml.replace(m[0], `<${m[1]}:txBody>${before}${ps.join("")}</${m[1]}:txBody>`);
  }
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
      const res = fn(i, cells, +h);
      if (res === false) return ""; // 줄 지우기
      const r = res || {};
      return `<a:tr h="${r.height || h}">${out.replace(/@@TC(\d+)@@/g, (_, k) => (r.cells || cells)[+k])}</a:tr>`;
    });
  }
  const SUMMARY_LINE = 70;
  const textWidth = (t) => [...String(t)].reduce((w, ch) => w + (/[ᄀ-ᇿ㄰-㆏가-힯一-鿿　-〿]/.test(ch) ? 1 : 0.55), 0);
  const rpct = (x) => `${(Math.round(x * 1000) / 10).toFixed(1)}%`;
  const rnum = (n) => Number(n || 0).toLocaleString("en-US");
  const pad2 = (n) => String(n).padStart(2, "0");
  // PPT 서체에 없는 이모지 등은 까만 네모로 보이므로 뺀다 · 답글 앞 @닉네임도 뺀다
  const pptSafe = (text) => String(text || "")
    .replace(/^\s*@\S+\s*/, "")
    .replace(/[\p{Extended_Pictographic}\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{E000}-\u{F8FF}︀-️​-‍⁠⃣�]/gu, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  function fitQuotes(list, budget, maxEach = 150) {
    const out = [];
    const used = [];
    let len = 0;
    for (const raw of list || []) {
      let t = pptSafe(raw).replace(/[‘’]/g, "'");
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
  const quoteKey = (t) => String(t || "").replace(/[\s‘’'"“”]/g, "");
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

  // 차트 원본 데이터(PPT '데이터 편집' 때 보이는 엑셀)도 같은 값으로: 2행부터 이름(글자)·값을 새로 쓴다
  async function fixChartWorkbook(bytes, cats, vals) {
    const emb = await Zip.read(bytes);
    const path = "xl/worksheets/sheet1.xml";
    let sh = Zip.text(emb.get(path));
    const cols = ["B", "C", "D", "E"];
    const rowXml = (k) => {
      const r = k + 2;
      return `<row r="${r}"><c r="A${r}" t="inlineStr"><is><t>${xesc(cats[k])}</t></is></c>${cols.map((c, si) => `<c r="${c}${r}" s="1"><v>${Math.round((vals[si][k] || 0) * 1000) / 1000}</v></c>`).join("")}</row>`;
    };
    sh = sh.replace(/<sheetData>(.*?)<\/sheetData>/s, (all, inner) => {
      const first = (inner.match(/<row r="1"[^>]*>.*?<\/row>|<row r="1"[^>]*\/>/s) || [""])[0];
      return `<sheetData>${first}${cats.map((_, k) => rowXml(k)).join("")}</sheetData>`;
    }).replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:E${cats.length + 1}"/>`);
    emb.set(path, Zip.bytes(sh));
    return Zip.write(emb);
  }

  // report: { title, summary[], headline, from, to, channelsLabel, rows[차종], stats{전체|차종: {posts, comments, n, 긍정…}}, short{성향:[글]}, long{성향:[글]} }
  async function fillReportSlides(files, slides, report) {
    const done = [];
    const all = report.stats["전체"] || { posts: 0, comments: 0, n: 0 };
    const rate = (st, s) => (st && st.n ? (st[s] || 0) / st.n : 0);
    const negAll = rate(all, "부정") + rate(all, "단순비난");
    const posAll = rate(all, "긍정");
    const titleParts = [[0, " ■"], [1, ` ${report.title}`]];
    const s1 = slides.find((s) => /name="표 15"/.test(Zip.text(files.get(s.part))) && /name="표 17"/.test(Zip.text(files.get(s.part))));
    const s2 = slides.find((s) => s !== s1 && /name="표 16"/.test(Zip.text(files.get(s.part))));
    const page1Shown = {};
    if (s1) {
      let x1 = Zip.text(files.get(s1.part));
      x1 = replaceShape(x1, "제목 9", (x) => setParagraphs(x, [titleParts]));
      const from = new Date(report.from);
      const to = new Date(report.to);
      x1 = replaceShape(x1, "직사각형 25", (x) => setParagraphs(x, [`모니터링 기간 : ${md(from)} ${hm(from)} ~ ${md(to)} ${hm(to)}`, `모니터링 채널 : ${report.channelsLabel}`]));
      const sumLines = (report.summary.length ? report.summary : [""]).slice(0, 3).map((t) => ` ${pptSafe(t)}`);
      x1 = replaceShape(x1, "직사각형 31", (x) => {
        x = setParagraphs(x, sumLines);
        const lines = sumLines.reduce((n, t) => n + Math.max(1, Math.ceil(textWidth(t) / SUMMARY_LINE)), 0);
        if (lines <= 3) return x;
        const sz = Math.max(1000, Math.floor((1400 * 3) / lines / 50) * 50);
        return x.replace(/(<a:(?:rPr|endParaRPr)[^>]*?) sz="\d+"/g, `$1 sz="${sz}"`);
      });
      const phrase = report.headline || headlinePhrase(negAll, posAll);
      const headParts = negAll >= posAll
        ? [[0, "부정 여론"], [1, "(부정+단순비난)"], [6, `이 긍정 여론 比 ${phrase} `], [10, "("], [11, rpct(negAll)], [12, " vs "], [13, rpct(posAll)], [14, ")"]]
        : [[0, "긍정 여론"], [6, "이 부정 여론"], [1, "(부정+단순비난)"], [6, ` 比 ${phrase} `], [10, "("], [13, rpct(posAll)], [12, " vs "], [11, rpct(negAll)], [14, ")"]];
      x1 = replaceShape(x1, "직사각형 21", (x) => setParagraphs(x, [headParts]));
      // 차종별 표: 머리 '채널'→'차종', 전체 줄, 차종 줄 (양식의 채널 4줄을 차종 수만큼)
      const rows = report.rows;
      x1 = replaceShape(x1, "표 15", (x) => {
        // 차종 줄 수 맞추기: 모자라면 마지막 줄을 복제, 남으면 지움 · 세로 합친 칸 수도 맞춤
        const trs = x.match(/<a:tr h="\d+">.*?<\/a:tr>/gs) || [];
        const body = trs.slice(2);
        if (body.length && rows.length > body.length) {
          const extra = Array.from({ length: rows.length - body.length }, () => body[body.length - 1]).join("");
          x = x.replace(body[body.length - 1], body[body.length - 1] + extra);
        }
        x = x.replace(/rowSpan="\d+"/, `rowSpan="${rows.length}"`);
        const valsOf = (st) => (st && (st.posts || st.n) ? [rnum(st.posts), rnum(st.comments), ...SENTI.map((s) => (st.n ? rpct(rate(st, s)) : "-"))] : ["-", "-", "-", "-", "-", "-"]);
        return mapTableRows(x, (i, cells) => {
          if (i === 0) return { cells: cells.map((c, j) => (j === 0 ? setParagraphs(c, ["차종"]) : c)) };
          if (i === 1) {
            const v = valsOf(report.stats["전체"]);
            return { cells: cells.map((c, j) => (j >= 2 ? setParagraphs(c, [v[j - 2]]) : c)) };
          }
          const name = rows[i - 2];
          if (!name) return false;
          const v = valsOf(report.stats[name]);
          return { cells: cells.map((c, j) => (j === 0 && i === 2 ? setParagraphs(c, ["동호회"]) : j === 1 ? setParagraphs(c, [name]) : j >= 2 ? setParagraphs(c, [v[j - 2]]) : c)) };
        });
      });
      // 성향별 주요 내용 (짧은 인용)
      x1 = replaceShape(x1, "표 17", (x) => mapTableRows(x, (i, cells) => {
        if (i === 0) return null;
        const s = SENTI[i - 1];
        const fit = fitQuotes(report.short[s] || [], 230, 90);
        page1Shown[s] = fit.used;
        return { cells: cells.map((c, j) => (j === 1 ? setParagraphs(c, [rpct(rate(all, s))]) : j === 2 ? setParagraphs(c, [fit.text || "-"]) : c)) };
      }));
      files.set(s1.part, Zip.bytes(x1));
      done.push("1p");
      // 차트 (가로 100% 누적 막대, 아래→위: 마지막 차종 … 첫 차종, 전 차종)
      const rels = files.get(relsPath(s1.part)) ? Zip.text(files.get(relsPath(s1.part))) : "";
      const chartTarget = (rels.match(/Target="([^"]*charts\/chart\d+\.xml)"/) || [])[1];
      if (chartTarget) {
        const chartPart = resolve(s1.part, chartTarget);
        const cats = [...rows].reverse().concat(["전 차종"]);
        const vals = SENTI.map((s) => cats.map((c) => rate(report.stats[c === "전 차종" ? "전체" : c], s)));
        let chart = Zip.text(files.get(chartPart));
        const lblTpl = (chart.match(/<c:dLbls>.*?<\/c:dLbls>/s) || [""])[0];
        const last = cats.length + 1;
        chart = chart.replace(/(\$[A-E]\$2:\$[A-E]\$)\d+/g, `$1${last}`);
        chart = chart.replace(/<c:cat>.*?<\/c:cat>/gs, (cat) => cat.replace(/<c:strCache>.*?<\/c:strCache>/s,
          `<c:strCache><c:ptCount val="${cats.length}"/>${cats.map((c, k) => `<c:pt idx="${k}"><c:v>${xesc(c)}</c:v></c:pt>`).join("")}</c:strCache>`));
        let si = -1;
        chart = chart.replace(/<c:ser>.*?<\/c:ser>/gs, (ser) => {
          si++;
          const v = vals[si] || [];
          ser = ser.replace(/<c:val>(.*?)<\/c:val>/s, (a, inner) => `<c:val>${inner.replace(/<c:numCache>(.*?)<\/c:numCache>/s, (b, nc) => {
            const fmt = (nc.match(/<c:formatCode>.*?<\/c:formatCode>/s) || [""])[0];
            return `<c:numCache>${fmt}<c:ptCount val="${cats.length}"/>${v.map((x, k) => `<c:pt idx="${k}"><c:v>${Math.round((x || 0) * 1000) / 1000}</c:v></c:pt>`).join("")}</c:numCache>`;
          })}</c:val>`);
          if (!/<c:dLbls>/.test(ser) && lblTpl) ser = ser.replace(/(<c:invertIfNegative[^>]*\/>)/, `$1${lblTpl}`);
          // 막대가 너무 짧은(5% 미만) 칸은 수치가 삐져나오므로 숨김
          const hide = v.map((x, k) => ((x > 0 && x < 0.05) || !x ? `<c:dLbl><c:idx val="${k}"/><c:delete val="1"/></c:dLbl>` : "")).join("");
          return ser.replace(/<c:dLbls>(?:<c:dLbl>.*?<\/c:dLbl>)*/s, `<c:dLbls>${hide}`);
        });
        files.set(chartPart, Zip.bytes(chart));
        const crels = files.get(relsPath(chartPart)) ? Zip.text(files.get(relsPath(chartPart))) : "";
        const embT = (crels.match(/Target="([^"]*embeddings\/[^"]+\.xlsx)"/) || [])[1];
        if (embT) {
          const embPart = resolve(chartPart, embT);
          if (files.has(embPart)) files.set(embPart, await fixChartWorkbook(files.get(embPart), cats, vals).catch(() => files.get(embPart)));
        }
        done.push("1p 차트");
      }
    }
    if (s2) {
      let x2 = Zip.text(files.get(s2.part));
      x2 = replaceShape(x2, "제목 9", (x) => setParagraphs(x, [titleParts]));
      const TOTAL_CHARS = 2700;
      const long = Object.fromEntries(SENTI.map((s) => {
        const keys = new Set((page1Shown[s] || []).map(quoteKey));
        return [s, (report.long[s] || []).filter((t) => !keys.has(quoteKey(t)))];
      }));
      const have = SENTI.map((s) => long[s].reduce((n, t) => n + String(t).length + 4, 0));
      const budgets = SENTI.map((s, k) => Math.min(have[k], Math.max(260, Math.round(TOTAL_CHARS / 4))));
      let spare = TOTAL_CHARS - budgets.reduce((a, b) => a + b, 0);
      for (let pass = 0; pass < 3 && spare > 20; pass++) {
        const hungry = SENTI.map((_, k) => k).filter((k) => have[k] > budgets[k]);
        if (!hungry.length) break;
        const addN = Math.floor(spare / hungry.length);
        for (const k of hungry) {
          const take = Math.min(addN, have[k] - budgets[k]);
          budgets[k] += take;
          spare -= take;
        }
      }
      const texts = SENTI.map((s, k) => fitQuotes(long[s], budgets[k]).text || "-");
      x2 = replaceShape(x2, "표 16", (x) => {
        let bodyTotal = 0;
        x.replace(/<a:tr h="(\d+)">/g, (_, h) => (bodyTotal += +h));
        bodyTotal -= +(x.match(/<a:tr h="(\d+)">/) || [0, 255664])[1];
        const weights = texts.map((t) => Math.max(t.length, 420));
        const wsum = weights.reduce((a, b) => a + b, 0);
        return mapTableRows(x, (i, cells) => {
          if (i === 0) return { cells: cells.map((c) => (/전 채널/.test(c) ? c.replace(/전 채널/g, "전 차종") : c)) };
          const s = SENTI[i - 1];
          return {
            height: Math.round((bodyTotal * weights[i - 1]) / wsum),
            cells: cells.map((c, j) => (j === 0 ? setParagraphs(c, [s, `(${rpct(rate(all, s))})`]) : setParagraphs(c, [texts[i - 1]]))),
          };
        });
      });
      files.set(s2.part, Zip.bytes(x2));
      done.push("2p");
    }
    return done;
  }

  async function fill(bytes, { cars = {}, title = "", onlyThis = false, report = null } = {}) {
    const files = await Zip.read(bytes);
    if (!files.has("ppt/presentation.xml")) throw new Error("PowerPoint(.pptx) 파일이 아닙니다");
    const pres = parse(files.get("ppt/presentation.xml"));
    const slides = slideList(files, pres);
    const target = slides.find((s) => {
      const doc = parse(files.get(s.part));
      return all(doc, P, "graphicFrame").some(isRankTable);
    });
    if (!target) throw new Error("'순위 · 내용 · 개수 · 비율' 표가 있는 슬라이드를 찾지 못했습니다 (보고 양식 3페이지가 있는 PPT 를 골라 주세요)");
    const doc = parse(files.get(target.part));
    const tree = all(doc, P, "spTree")[0];
    const shapes = [...tree.childNodes].filter((n) => n.nodeType === 1 && ["sp", "graphicFrame", "grpSp", "pic", "cxnSp"].includes(n.localName));
    const carNames = Object.keys(cars);
    // 차종 이름 상자: 글자가 차종 이름뿐인 도형 (위에서 아래 순)
    const labels = shapes
      .filter((s) => s.localName === "sp" && carNames.includes(textOf(s)))
      .map((s) => ({ sp: s, car: textOf(s), ...xfrmOf(s) }))
      .filter((l) => Number.isFinite(l.y))
      .sort((a, b) => a.y - b.y);
    if (!labels.length) throw new Error(`슬라이드에서 차종 이름 상자(${carNames.join(" · ")})를 찾지 못했습니다`);
    const tables = shapes.filter((s) => s.localName === "graphicFrame" && isRankTable(s)).map((s) => ({ el: s, ...xfrmOf(s) }));
    const bars = shapes
      .filter((s) => s.localName === "sp" && /^(긍정|부정)$/.test(textOf(s)))
      .map((s) => ({ el: s, tone: textOf(s), ...xfrmOf(s) }));
    const inRow = (l, el) => el.y >= l.y - 5000 && el.y < l.y + l.h;
    // 표가 있는 첫 줄을 본으로 삼아, 표가 없는 차종 줄에 복제
    const base = labels.find((l) => tables.some((t) => inRow(l, t)));
    if (!base) throw new Error("차종 줄 안에 있는 순위 표를 찾지 못했습니다");
    let maxId = Math.max(0, ...all(doc, P, "cNvPr").map((c) => Number(c.getAttribute("id")) || 0));
    const cloneShifted = (el, dy) => {
      const c = el.cloneNode(true);
      const x = xfrmOf(c);
      x.off.setAttribute("y", String(x.y + dy));
      for (const nv of all(c, P, "cNvPr")) nv.setAttribute("id", String(++maxId));
      tree.appendChild(c);
      return c;
    };
    for (const l of labels) {
      if (l === base || tables.some((t) => inRow(l, t))) continue;
      const dy = l.y - base.y;
      for (const t of tables.filter((t) => inRow(base, t))) tables.push({ ...xfrmOf(cloneShifted(t.el, dy)), el: tree.lastChild });
      for (const b of bars.filter((b) => b.y >= base.y - 5000 && b.y < base.y + base.h)) {
        if (!bars.some((o) => o.tone === b.tone && inRow(l, o))) bars.push({ ...xfrmOf(cloneShifted(b.el, dy)), el: tree.lastChild, tone: b.tone });
      }
    }
    // 각 줄: 표마다 그 위 머리 띠(긍정/부정)로 어느 쪽인지 정한다 (띠가 없으면 왼쪽 긍정 · 오른쪽 부정)
    const filled = [];
    for (const l of labels) {
      const row = tables.filter((t) => inRow(l, t)).sort((a, b) => a.x - b.x);
      const data = cars[l.car] || { pos: [], neg: [] };
      row.forEach((t, i) => {
        const bar = bars.find((b) => Math.abs(b.x - t.x) < 200000 && b.y <= t.y && b.y >= l.y - 5000);
        const tone = bar ? bar.tone : i === 0 ? "긍정" : "부정";
        fillTable(t.el, tone === "긍정" ? data.pos || [] : data.neg || []);
        filled.push(`${l.car} ${tone}`);
      });
    }
    // 제목
    if (title) {
      const titleSp = shapes.find((s) => s.localName === "sp" && all(s, P, "ph").some((ph) => /title/i.test(ph.getAttribute("type") || "")));
      if (titleSp) setShapeText(titleSp, title);
    }
    files.set(target.part, Zip.bytes(ser(doc)));
    if (report && !onlyThis) filled.push(...(await fillReportSlides(files, slides, report)));
    if (onlyThis && slides.length > 1) {
      for (const s of slides) {
        if (s === target) continue;
        s.sldId.parentNode.removeChild(s.sldId);
      }
      files.set("ppt/presentation.xml", Zip.bytes(ser(pres)));
      const rels = parse(files.get("ppt/_rels/presentation.xml.rels"));
      for (const r of all(rels, PR, "Relationship")) {
        if (r.getAttribute("Type") === T_SLIDE && r.getAttribute("Id") !== target.rid) r.parentNode.removeChild(r);
      }
      files.set("ppt/_rels/presentation.xml.rels", Zip.bytes(ser(rels)));
      dropUnreachable(files);
    }
    return { bytes: await Zip.write(files), filled };
  }

  global.PptFill = { fill };
})(typeof window !== "undefined" ? window : globalThis);
