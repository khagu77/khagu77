// 보고서 PPT 의 '차종별 긍정·부정 주요 내용 TOP5' 슬라이드(첨부 양식 3p)를 채운다.
// 회사 보고서 양식은 공개 저장소에 넣지 않으므로, 화면에서 사용자가 고른 보고서 PPT 파일을 그대로 틀로 쓴다.
//
//  - '순위 · 내용 · 개수 · 비율' 머리글 표가 있는 슬라이드를 찾는다.
//  - 차종 이름 상자(아반떼 · 그랜저 · 싼타페)마다 한 줄: 왼쪽 표는 '긍정', 오른쪽 표는 '부정' 머리 띠 아래 표.
//    표가 첫 줄(아반떼)에만 있으면 머리 띠와 표를 복제해 다른 차종 줄에 같은 간격으로 놓는다.
//  - 표의 1~5위 줄에 내용 · 개수 · 비율을 쓴다 (모자라면 빈칸, 양식의 '예시)' 글은 지움).
//  - 제목을 바꾸고, 원하면 나머지 슬라이드는 뺀다(쓰지 않게 된 차트·노트 등은 함께 지움).
//
// PptFill.fill(bytes, { cars: { 아반떼: { pos: [{ label, count, ratio }], neg: [...] }, ... }, title, onlyThis })
//   → Promise<Uint8Array>
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

  async function fill(bytes, { cars = {}, title = "", onlyThis = true } = {}) {
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
