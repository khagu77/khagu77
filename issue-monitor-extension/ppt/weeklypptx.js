// 주간 보고서 PPT 만들기: 담당자가 넣어 둔 주간 보고서 양식(지난주 보고서)의 표에서
// 데이터 줄 하나를 본떠 이번 주 게시글 수만큼 줄을 다시 만든다 (글꼴·테두리·칸 모양은 양식 그대로)
// 표 칸: 구분 | 차종 | 현상 | 상세 내용 | 온라인 모니터링 단계(주의/경고/심각) | 조회수 / 댓글 | 비고(신규·중복 / 보고 일자)
(function (global) {
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const LEVEL_COLORS = { 주의: "00B050", 경고: "0563C1", 심각: "C00000" };

  const parse = (u8) => new DOMParser().parseFromString(Zip.text(u8), "application/xml");
  const ser = (doc) => Zip.bytes(new XMLSerializer().serializeToString(doc));
  const all = (n, ns, name) => [...n.getElementsByTagNameNS(ns, name)];
  const kids = (n, ns, name) => [...n.childNodes].filter((c) => c.namespaceURI === ns && c.localName === name);
  const textOf = (n) => all(n, A, "t").map((t) => t.textContent).join("");

  // 칸의 문단들을 새 글자로 바꾼다. paras: [[["글자", 색|null], …], …] — 문단 모양·글꼴은 원래 첫 글자 조각 그대로
  function setCell(tc, paras) {
    const doc = tc.ownerDocument;
    const body = all(tc, A, "txBody")[0];
    let ps = kids(body, A, "p");
    const model = (p) => {
      const r = kids(p, A, "r")[0];
      const rp = r && kids(r, A, "rPr")[0];
      if (rp) return rp.cloneNode(true);
      const end = kids(p, A, "endParaRPr")[0];
      if (end) {
        const x = doc.createElementNS(A, "a:rPr");
        for (const at of [...end.attributes]) x.setAttribute(at.name, at.value);
        for (const c of [...end.childNodes]) x.appendChild(c.cloneNode(true));
        return x;
      }
      return doc.createElementNS(A, "a:rPr");
    };
    const firstModel = ps.length ? model(ps[0]) : doc.createElementNS(A, "a:rPr");
    while (ps.length < paras.length) {
      const c = ps[ps.length - 1].cloneNode(true);
      body.appendChild(c);
      ps = kids(body, A, "p");
    }
    paras.forEach((runs, i) => {
      const p = ps[i];
      const rpModel = kids(p, A, "r").length ? model(p) : firstModel.cloneNode(true);
      for (const c of [...p.childNodes]) if (c.namespaceURI === A && /^(r|br|fld)$/.test(c.localName)) p.removeChild(c);
      const end = kids(p, A, "endParaRPr")[0] || null;
      for (const [text, color] of runs) {
        const r = doc.createElementNS(A, "a:r");
        const rp = rpModel.cloneNode(true);
        rp.removeAttribute("err");
        if (color) {
          for (const f of kids(rp, A, "solidFill")) rp.removeChild(f);
          const fill = doc.createElementNS(A, "a:solidFill");
          const clr = doc.createElementNS(A, "a:srgbClr");
          clr.setAttribute("val", color);
          fill.appendChild(clr);
          // solidFill 은 rPr 안에서 ln 다음, latin/ea 앞에 와야 한다
          const before = [...rp.childNodes].find((c) => c.namespaceURI === A && !/^(ln)$/.test(c.localName));
          rp.insertBefore(fill, before || null);
        }
        r.appendChild(rp);
        const t = doc.createElementNS(A, "a:t");
        t.textContent = text;
        r.appendChild(t);
        p.insertBefore(r, end);
      }
    });
    for (const extra of ps.slice(paras.length)) body.removeChild(extra);
  }

  const num = (v) => {
    const n = String(v ?? "").replace(/[^\d]/g, "");
    return n ? Number(n).toLocaleString("en-US") : "-";
  };

  // items: [{ community, code, issue, body, level, views, comments, duplicate, reportDate: "2026-10-12" }]
  async function build(templateBytes, items) {
    const files = await Zip.read(templateBytes);
    const slides = [...files.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
    let done = false;
    for (const path of slides) {
      const doc = parse(files.get(path));
      const tbl = all(doc, A, "tbl").find((t) => /상세\s*내용/.test(textOf(t)) && /차종/.test(textOf(t)));
      if (!tbl) continue;
      const rows = kids(tbl, A, "tr");
      // 데이터 줄 = 첫 칸이 '온라인' 으로 시작하는 줄 (그 위는 머리글)
      const dataRows = rows.filter((tr) => /^\s*온라인/.test(textOf(kids(tr, A, "tc")[0] || tr)));
      if (!dataRows.length) throw new Error("양식 표에서 게시글 줄(구분 칸이 '온라인'인 줄)을 찾지 못했습니다");
      const proto = dataRows[0].cloneNode(true);
      for (const ex of all(proto, A, "extLst")) if (ex.parentNode === proto) proto.removeChild(ex);
      for (const tr of dataRows) tbl.removeChild(tr);
      for (const it of items) {
        const tr = proto.cloneNode(true);
        const tc = kids(tr, A, "tc");
        const [y, m, d] = String(it.reportDate || "").split("-").map(Number);
        setCell(tc[0], [[["온라인", null]], [[it.community ? "(자동차 커뮤니티)" : "(동호회)", null]]]);
        setCell(tc[1], [[[it.code || "-", null]]]);
        setCell(tc[2], [[[it.issue || "", null]]]);
        setCell(tc[3], [[[it.body || "", null]]]);
        const lv = LEVEL_COLORS[it.level] ? it.level : "주의";
        setCell(tc[4], [[[lv, LEVEL_COLORS[lv]]]]);
        setCell(tc[5], [[[`조회수 ${num(it.views)} / 댓글 ${num(it.comments)}`, null]]]);
        setCell(tc[6], [[[it.duplicate || "신규", null]], [[m && d ? `(${m}/${d} 보고)` : "", null]]]);
        tbl.appendChild(tr);
      }
      files.set(path, ser(doc));
      done = true;
      break;
    }
    if (!done) throw new Error("양식에서 주간 보고서 표('차종', '상세 내용' 머리글이 있는 표)를 찾지 못했습니다");
    return Zip.write(files);
  }

  global.WeeklyPptx = { build, LEVEL_COLORS };
})(typeof window !== "undefined" ? window : self);
