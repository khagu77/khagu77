// 월간 실적 보고 PPT (담당자 요청 2026-11-13)
// 지난달 실적 보고 PPT 를 그대로 틀로 쓰고 '글자만' 바꾼다. 서체·크기·굵기·색·칸 배경·테두리·점선 박스는 원본 그대로.
//  1페이지: 제목(‘YY.M월, 기간), 개요 2줄, 표 — 지난달 칸(파란 점선)은 오른쪽 '전월' 칸으로 옮기고 왼쪽 칸에 이번 달 값
//           온라인 상시 모니터링 '내용' = 주요 이슈 목록, 모니터링 동호회 '내용' = "YY년 M월 現, N개 동호회 모니터링 中",
//           번외 추가 요청 보고 '내용' = "제목 (날짜)" 목록
//  2페이지: 제목, 개요, 차종 별 비율(이번 달 순위순, 전월은 같은 차종의 지난달 건수, TOP5 파란 점선 박스),
//           카테고리 비율·채널 별 비율(이번 달 / 비율 / 전월)
// 글자 바꾸기는 문단의 글자 덩어리(run) 서식을 그대로 두고 그 안의 글자만 바꾼다.
(function (global) {
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const all = (n, ns, name) => [...n.getElementsByTagNameNS(ns, name)];
  const kids = (n, ns, name) => [...n.childNodes].filter((c) => c.namespaceURI === ns && c.localName === name);
  const paraText = (p) => all(p, A, "t").map((t) => t.textContent).join("");
  const cellText = (tc) => all(tc, A, "p").map(paraText).join("\n").trim();
  const rowsOf = (tbl) => kids(tbl, A, "tr").map((tr) => kids(tr, A, "tc"));

  // 문단 안 글자를 정규식으로 바꾼다 (바뀐 글자는 그 글자가 시작된 run 의 서식을 따른다)
  function replaceInPara(p, re, fn) {
    const runs = all(p, A, "r").map((r) => all(r, A, "t")[0]).filter(Boolean);
    const text = runs.map((t) => t.textContent).join("");
    const matches = [...text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))];
    if (!matches.length) return 0;
    let n = 0;
    const reps = matches.map((m) => ({ s: m.index, e: m.index + m[0].length, v: fn(m, n++) }));
    for (const { s, e, v } of reps.reverse()) {
      let pos = 0;
      let placed = false;
      for (const t of runs) {
        const str = t.textContent;
        const a = pos;
        const b = pos + str.length;
        pos = b;
        if (b <= s || a >= e) continue;
        const from = Math.max(s, a) - a;
        const to = Math.min(e, b) - a;
        t.textContent = str.slice(0, from) + (placed ? "" : v) + str.slice(to);
        placed = true;
      }
    }
    return reps.length;
  }
  function replaceInShape(node, re, fn) {
    let n = 0;
    for (const p of all(node, A, "p")) n += replaceInPara(p, re, fn);
    return n;
  }

  // 칸/도형 글자를 줄 목록으로 다시 쓴다: 첫 문단의 문단 서식 + 첫 글자 덩어리 서식을 그대로 복사
  // segs(line) 가 [{text, run}] 를 돌려주면 run 번째 원본 글자 덩어리 서식을 쓴다 (예: "○" 와 본문 서식이 다를 때)
  function setLines(container, lines, segs) {
    const body = all(container, A, "txBody")[0] || all(container, P, "txBody")[0] || container;
    const paras = kids(body, A, "p");
    const tpl = paras[0];
    const tplRuns = all(tpl, A, "r");
    const end = all(tpl, A, "endParaRPr")[0];
    const doc = body.ownerDocument;
    for (const p of paras) body.removeChild(p);
    const list = lines.length ? lines : [""];
    for (const line of list) {
      const p = doc.createElementNS(A, "a:p");
      const pPr = kids(tpl, A, "pPr")[0];
      if (pPr) p.appendChild(pPr.cloneNode(true));
      const parts = segs ? segs(line) : [{ text: line, run: 0 }];
      for (const s of parts) {
        if (s.text === "") continue;
        const src = tplRuns[Math.min(s.run, tplRuns.length - 1)];
        const r = doc.createElementNS(A, "a:r");
        const rPr = src && kids(src, A, "rPr")[0];
        if (rPr) r.appendChild(rPr.cloneNode(true));
        const t = doc.createElementNS(A, "a:t");
        t.textContent = s.text;
        r.appendChild(t);
        p.appendChild(r);
      }
      if (end) p.appendChild(end.cloneNode(true));
      else if (tplRuns[0] && kids(tplRuns[0], A, "rPr")[0]) {
        const e = doc.createElementNS(A, "a:endParaRPr");
        for (const at of kids(tplRuns[0], A, "rPr")[0].attributes) e.setAttribute(at.name, at.value);
        p.appendChild(e);
      }
      body.appendChild(p);
    }
  }
  // 칸 하나의 글자(한 줄)만 바꾸기: 첫 글자 덩어리 서식 유지
  const setCell = (tc, text) => setLines(tc, [String(text)]);

  const shapes = (doc) => all(doc, P, "sp");
  const nameOf = (sp) => (all(sp, P, "cNvPr")[0] || { getAttribute: () => "" }).getAttribute("name") || "";
  const shapeText = (sp) => all(sp, A, "p").map(paraText).join("\n").trim();
  const titleShape = (doc) => shapes(doc).find((sp) => /온라인\s*여론\s*동향/.test(shapeText(sp)));
  // 개요 글 상자: '○' 로 시작하는 글 상자
  const overviewShape = (doc) => shapes(doc).find((sp) => /^○/.test(shapeText(sp)));
  const tables = (doc) =>
    all(doc, P, "graphicFrame")
      .map((gf) => ({ gf, tbl: all(gf, A, "tbl")[0] }))
      .filter((x) => x.tbl);
  const tableByHead = (doc, re) => tables(doc).find((x) => re.test(cellText(rowsOf(x.tbl)[0][0] || x.tbl)) || re.test(rowsOf(x.tbl).slice(0, 2).flat().map(cellText).join(" ")));

  const parse = (xml) => new DOMParser().parseFromString(xml, "application/xml");
  const ser = (doc) => new XMLSerializer().serializeToString(doc);
  const slidePaths = (files) => [...files.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);

  // 표에서 '항목' 이름으로 줄 찾기
  const findRow = (rows, re) => rows.find((r) => r[0] && re.test(cellText(r[0]).replace(/\s+/g, " ")));
  const numOf = (s) => {
    const m = String(s || "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    return m ? +m[0] : 0;
  };

  // ---------------------------------------------------------------------------
  // 읽기: 지난 보고서의 값 (화면 초기값·전월 값·개요 문체 예시)
  // ---------------------------------------------------------------------------
  async function read(bytes) {
    const files = await Zip.read(bytes);
    const paths = slidePaths(files);
    const out = { title: "", year: 0, month: 0, period: "", overview1: [], overview2: [], s1: {}, prev: { cars: [], cats: [], chans: [] } };
    paths.forEach((path, i) => {
      const doc = parse(dec.decode(files.get(path)));
      const t = titleShape(doc);
      if (t && !out.title) {
        out.title = shapeText(t);
        const m = out.title.match(/[‘'’](\d{2})\.\s*(\d{1,2})\s*월/);
        if (m) {
          out.year = 2000 + +m[1];
          out.month = +m[2];
        }
        const pm = out.title.match(/\(([^)]*~[^)]*)\)/);
        if (pm) out.period = pm[1].trim();
      }
      const ov = overviewShape(doc);
      if (ov) out[i === 0 ? "overview1" : "overview2"] = all(ov, A, "p").map(paraText).map((s) => s.replace(/^○\s*/, "").trim()).filter(Boolean);
      const s1 = tableByHead(doc, /항\s*목|기간/);
      if (s1 && i === 0) {
        const rows = rowsOf(s1.tbl);
        const val = (re, col = 1) => {
          const r = findRow(rows, re);
          return r && r[col] ? cellText(r[col]) : "";
        };
        const contentLines = (re) => {
          const r = findRow(rows, re);
          return r && r[3] ? all(r[3], A, "p").map(paraText).map((s) => s.trim()).filter((s) => s && s !== "-") : [];
        };
        out.s1 = {
          online: numOf(val(/온라인\s*상시/)),
          fire: numOf(val(/화재|급발진/)),
          collect: numOf(val(/시스템\s*수집/)),
          cafes: numOf(val(/모니터링\s*동호회/)),
          youtube: numOf(val(/유튜브/)),
          extraCount: numOf(val(/번외/)),
          issues: contentLines(/온라인\s*상시/),
          extras: contentLines(/번외/).map((s) => {
            // 끝 괄호가 날짜일 때만 날짜로 (예: "(10/12)", "(9/10~)") — "(온라인 부분)" 같은 건 제목의 일부
            const m = s.match(/^(.*?)\s*\((\s*\d{1,2}\s*\/\s*\d{1,2}[^()]*)\)\s*$/);
            return m ? { title: m[1].trim(), date: m[2].trim() } : { title: s, date: "" };
          }),
        };
      }
      const car = tableByHead(doc, /차종\s*별/);
      if (car) {
        const rows = rowsOf(car.tbl);
        for (const r of rows.slice(2)) {
          const name = cellText(r[0]);
          if (!name || /합계/.test(name)) continue;
          out.prev.cars.push({ code: name, count: numOf(cellText(r[1])) });
        }
      }
      const cat = tableByHead(doc, /카테고리/);
      if (cat) for (const r of rowsOf(cat.tbl).slice(2)) if (!/합계/.test(cellText(r[0]))) out.prev.cats.push({ name: cellText(r[0]), count: numOf(cellText(r[1])) });
      const ch = tableByHead(doc, /채널/);
      if (ch) for (const r of rowsOf(ch.tbl).slice(2)) if (!/합계/.test(cellText(r[0]))) out.prev.chans.push({ name: cellText(r[0]), count: numOf(cellText(r[1])) });
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // 만들기
  // ---------------------------------------------------------------------------
  // d = { year, month, start: Date, end: Date, overview1: [..], overview2: [..],
  //       s1: { online, fire, collect, cafes, youtube, extraCount, issues: [..], extras: [{title, date}] },
  //       cars: [{code, cur, prev}], cats: [{name, cur, prev}], chans: [{name, cur, prev}] }
  const yy = (y) => String(y % 100).padStart(2, "0");
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const fmtNum = (n) => Number(n || 0).toLocaleString("en-US");
  function pctText(n, total, tplText) {
    const digits = (String(tplText || "").match(/\.(\d+)%/) || [, ""])[1].length; // 원본 칸의 소수점 자리 그대로
    const v = total ? (n / total) * 100 : 0;
    return `${v.toFixed(digits)}%`;
  }

  function editTitle(doc, d) {
    const t = titleShape(doc);
    if (!t) return;
    replaceInShape(t, /([‘'’])\d{2}\.\s*\d{1,2}(?=\s*월)/, (m) => `${m[1]}${yy(d.year)}.${d.month}`);
    const dates = [d.start, d.end];
    // 기간: ‘26.9/24 ~ ‘26.10/23 의 날짜 두 개
    replaceInShape(t, /([‘'’])\d{2}\.\d{1,2}\/\d{1,2}/, (m, i) => `${m[1]}${yy(dates[Math.min(i, 1)].getFullYear())}.${md(dates[Math.min(i, 1)])}`);
  }

  function editOverview(doc, lines) {
    const ov = overviewShape(doc);
    if (!ov || !lines || !lines.length) return;
    // 원본 첫 문단: "○" 글자 덩어리 + 본문 글자 덩어리
    const firstRuns = all(kids(all(ov, P, "txBody")[0], A, "p")[0], A, "r");
    const bodyRun = firstRuns.findIndex((r) => paraText(r).replace(/[○\s]/g, ""));
    setLines(ov, lines, (line) => [
      { text: "○", run: 0 },
      { text: ` ${String(line).replace(/^○\s*/, "").trim()}`, run: bodyRun > 0 ? bodyRun : 0 },
    ]);
  }

  function editSlide1(doc, d) {
    const s1 = tableByHead(doc, /항\s*목|기간/);
    if (!s1) return;
    const rows = rowsOf(s1.tbl);
    // 지난달 칸(왼쪽, 파란 점선) → 오른쪽 '전월' 칸으로 글자째 옮김 (칸 배경·테두리는 각 칸 그대로)
    for (const r of rows.slice(1)) {
      if (r.length < 3) continue;
      const from = all(r[1], A, "txBody")[0];
      const to = all(r[2], A, "txBody")[0];
      if (from && to) r[2].replaceChild(from.cloneNode(true), to);
    }
    // 기간 머리글: "2026년 11월 / (26.10/24 ~ 26.11/25)"
    const head = rows[1] && rows[1][1];
    if (head) {
      replaceInShape(head, /\d{4}(?=\s*년)/, () => String(d.year));
      replaceInShape(head, /\d{1,2}(?=\s*월)/, () => String(d.month));
      const dates = [d.start, d.end];
      replaceInShape(head, /\d{2}\.\d{1,2}\/\d{1,2}/, (m, i) => `${yy(dates[Math.min(i, 1)].getFullYear())}.${md(dates[Math.min(i, 1)])}`);
    }
    const num = (re, value) => {
      const r = findRow(rows, re);
      if (r && r[1] && value != null && value !== "") replaceInShape(r[1], /[\d,]+/, () => fmtNum(value));
    };
    num(/온라인\s*상시/, d.s1.online);
    num(/화재|급발진/, d.s1.fire);
    num(/시스템\s*수집/, d.s1.collect);
    num(/모니터링\s*동호회/, d.s1.cafes);
    num(/유튜브/, d.s1.youtube);
    num(/번외/, d.s1.extraCount);
    const issues = findRow(rows, /온라인\s*상시/);
    if (issues && issues[3] && d.s1.issues && d.s1.issues.length) setLines(issues[3], d.s1.issues);
    const cafes = findRow(rows, /모니터링\s*동호회/);
    if (cafes && cafes[3]) {
      replaceInShape(cafes[3], /\d{2}(?=\s*년)/, () => yy(d.year));
      replaceInShape(cafes[3], /\d{1,2}(?=\s*월)/, () => String(d.month));
      if (d.s1.cafes) replaceInShape(cafes[3], /\d+(?=\s*개)/, () => String(d.s1.cafes));
    }
    const extra = findRow(rows, /번외/);
    if (extra && extra[3] && d.s1.extras) {
      const lines = d.s1.extras.filter((x) => x.title && x.title.trim()).map((x) => `${x.title.trim()}${x.date && x.date.trim() ? ` (${x.date.trim()})` : ""}`);
      setLines(extra[3], lines.length ? lines : ["-"]);
    }
  }

  // 표 칸 글자 크기 (sz) 줄이기
  function scaleFont(tr, ratio) {
    for (const el of [...all(tr, A, "rPr"), ...all(tr, A, "endParaRPr")]) {
      const sz = +el.getAttribute("sz");
      if (sz) el.setAttribute("sz", String(Math.max(500, Math.round((sz * ratio) / 50) * 50)));
    }
  }

  function editCarTable(doc, d, monthLabel, prevLabel) {
    const x = tableByHead(doc, /차종\s*별/);
    if (!x) return;
    const { gf, tbl } = x;
    const trs = kids(tbl, A, "tr");
    const head = trs.slice(0, 2);
    const sum = trs[trs.length - 1];
    const body = trs.slice(2, -1);
    if (!body.length) return;
    // 이번 달·전월 모두 0건인 차종 줄은 뺀다 (담당자 요청 2026-11-13)
    d = { ...d, cars: d.cars.filter((c) => c.cur || c.prev) };
    const hcells = kids(head[1], A, "tc");
    if (hcells[1]) setCell(hcells[1], monthLabel);
    if (hcells[3]) setCell(hcells[3], prevLabel);
    const total = d.cars.reduce((s, c) => s + c.cur, 0);
    const prevTotal = d.cars.reduce((s, c) => s + c.prev, 0);
    const tplPct = cellText(kids(body[0], A, "tc")[2]);
    // 줄 높이: 원래 몸통 줄 높이 합을 새 줄 수로 나눔 (표 전체 크기 그대로)
    const bodyH = body.reduce((s, tr) => s + +tr.getAttribute("h"), 0);
    const n = Math.max(1, d.cars.length);
    const h = Math.floor(bodyH / n);
    const ratio = n > body.length ? body.length / n : 1;
    for (const tr of body) tbl.removeChild(tr);
    d.cars.forEach((c, i) => {
      const tr = body[Math.min(i, body.length - 1)].cloneNode(true); // 같은 순위 자리의 원래 줄 서식
      tr.setAttribute("h", String(h));
      const tc = kids(tr, A, "tc");
      setCell(tc[0], c.code);
      setCell(tc[1], String(c.cur));
      setCell(tc[2], pctText(c.cur, total, tplPct));
      setCell(tc[3], String(c.prev));
      if (ratio < 1) scaleFont(tr, ratio);
      tbl.insertBefore(tr, sum);
    });
    const sc = kids(sum, A, "tc");
    setCell(sc[1], String(total));
    setCell(sc[2], pctText(total, total, cellText(sc[2]) || tplPct));
    setCell(sc[3], String(prevTotal));
    // TOP5 파란 점선 박스: 몸통 1~5번째 줄에 맞춤
    const off = all(gf, A, "off")[0];
    const top = +off.getAttribute("y") + head.reduce((s, tr) => s + +tr.getAttribute("h"), 0);
    const box = shapes(doc).find((sp) => {
      const ln = all(sp, A, "prstDash")[0];
      const o = all(sp, A, "off")[0];
      return ln && o && Math.abs(+o.getAttribute("x") - +off.getAttribute("x")) < 200000 && +o.getAttribute("y") > +off.getAttribute("y") && +o.getAttribute("y") < top + bodyH;
    });
    if (box) {
      const o = all(box, A, "off")[0];
      const ext = all(box, A, "ext").find((e) => e.parentNode.localName === "xfrm");
      o.setAttribute("y", String(top));
      if (ext) ext.setAttribute("cy", String(h * Math.min(5, n)));
    }
  }

  function editSmallTable(doc, re, list, monthLabel, prevLabel) {
    const x = tableByHead(doc, re);
    if (!x) return;
    const rows = rowsOf(x.tbl);
    if (rows[1]) {
      if (rows[1][1]) setCell(rows[1][1], monthLabel);
      if (rows[1][3]) setCell(rows[1][3], prevLabel);
    }
    const total = list.reduce((s, c) => s + c.cur, 0);
    const prevTotal = list.reduce((s, c) => s + c.prev, 0);
    for (const r of rows.slice(2)) {
      const name = cellText(r[0]);
      const tpl = cellText(r[2]);
      if (/합계/.test(name)) {
        setCell(r[1], String(total));
        setCell(r[2], pctText(total, total, tpl));
        setCell(r[3], String(prevTotal));
        continue;
      }
      const item = list.find((c) => c.name === name) || { cur: 0, prev: 0 };
      setCell(r[1], String(item.cur));
      setCell(r[2], pctText(item.cur, total, tpl));
      setCell(r[3], String(item.prev));
    }
  }

  async function build(templateBytes, d) {
    const files = await Zip.read(templateBytes);
    const paths = slidePaths(files);
    const monthLabel = `${d.month}월`;
    const prevLabel = `${d.month === 1 ? 12 : d.month - 1}월`;
    paths.forEach((path, i) => {
      const doc = parse(dec.decode(files.get(path)));
      editTitle(doc, d);
      if (i === 0) {
        editOverview(doc, d.overview1);
        editSlide1(doc, d);
      } else if (i === 1) {
        editOverview(doc, d.overview2);
        editCarTable(doc, d, monthLabel, prevLabel);
        editSmallTable(doc, /카테고리/, d.cats, monthLabel, prevLabel);
        editSmallTable(doc, /채널/, d.chans, monthLabel, prevLabel);
      }
      files.set(path, enc.encode(ser(doc)));
    });
    return Zip.write(files);
  }

  // 표의 항목 이름 (카테고리·채널) — 집계할 때 쓴다
  async function labels(templateBytes) {
    const files = await Zip.read(templateBytes);
    const out = { cats: [], chans: [] };
    for (const path of slidePaths(files)) {
      const doc = parse(dec.decode(files.get(path)));
      const cat = tableByHead(doc, /카테고리/);
      if (cat) out.cats = rowsOf(cat.tbl).slice(2).map((r) => cellText(r[0])).filter((s) => s && !/합계/.test(s));
      const ch = tableByHead(doc, /채널/);
      if (ch) out.chans = rowsOf(ch.tbl).slice(2).map((r) => cellText(r[0])).filter((s) => s && !/합계/.test(s));
    }
    return out;
  }

  global.MonthlyPptx = { read, build, labels };
})(typeof window !== "undefined" ? window : self);
