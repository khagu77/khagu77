// 보고서 PPT 만들기 - 기존 완성본 보고서(.pptx)를 템플릿으로 써서 서식·폰트·안내선을 그대로 유지한다.
//  1장 표지(날짜), 2장 요약표, 3장 구분 값 정의는 그대로 두고 값만 바꾼다.
//  4장(첫 번째 상세 슬라이드)을 틀로 삼아 게시물 수만큼 복제하고, 템플릿에 있던 나머지 상세 슬라이드는 지운다.
(function (global) {
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const PR = "http://schemas.openxmlformats.org/package/2006/relationships";
  const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
  const T_SLIDE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
  const T_IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
  const T_LINK = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
  const T_NOTES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";
  const SLIDE_CT = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
  // 불만 구분 글자색: 주의 초록 / 경고 파랑 / 심각 진한 빨강 (해당 단계에만 색)
  const LEVEL_COLORS = { 주의: "00B050", 경고: "0563C1", 심각: "C00000" };
  const RED = "FF0000";
  const TODO = "확인 필요";

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

  // ---------- 텍스트 교체 (첫 글자 묶음(run)의 서식을 복제) ----------
  function setFill(rPr, hex) {
    for (const f of kids(rPr, A, "solidFill")) rPr.removeChild(f);
    const fill = rPr.ownerDocument.createElementNS(A, "a:solidFill");
    const clr = rPr.ownerDocument.createElementNS(A, "a:srgbClr");
    clr.setAttribute("val", hex);
    fill.appendChild(clr);
    const ln = kids(rPr, A, "ln")[0];
    if (ln) ln.after(fill);
    else rPr.insertBefore(fill, rPr.firstChild);
  }

  function baseRun(p) {
    const r = kids(p, A, "r")[0];
    if (r) return r.cloneNode(true);
    const doc = p.ownerDocument;
    const run = doc.createElementNS(A, "a:r");
    const rPr = doc.createElementNS(A, "a:rPr");
    const end = kids(p, A, "endParaRPr")[0];
    if (end) {
      for (const at of end.attributes) rPr.setAttribute(at.name, at.value);
      for (const c of end.childNodes) rPr.appendChild(c.cloneNode(true));
    }
    run.appendChild(rPr);
    run.appendChild(doc.createElementNS(A, "a:t"));
    return run;
  }

  // parts: 문자열 또는 [글자, 색(hex)|null] 목록
  function setPara(p, parts) {
    if (typeof parts === "string") parts = [[parts, null]];
    const base = baseRun(p);
    for (const n of [...p.childNodes]) {
      if (n.namespaceURI === A && ["r", "br", "fld"].includes(n.localName)) p.removeChild(n);
    }
    const end = kids(p, A, "endParaRPr")[0] || null;
    for (const [text, color] of parts) {
      const r = base.cloneNode(true);
      let rPr = kids(r, A, "rPr")[0];
      if (!rPr) {
        rPr = p.ownerDocument.createElementNS(A, "a:rPr");
        r.insertBefore(rPr, r.firstChild);
      }
      rPr.removeAttribute("err");
      if (color) setFill(rPr, color);
      kids(r, A, "t")[0].textContent = text;
      p.insertBefore(r, end);
    }
  }

  // paras: 문단별 parts 목록
  function setCell(tc, ...paras) {
    const body = all(tc, A, "txBody")[0];
    let ps = kids(body, A, "p");
    while (ps.length < paras.length) {
      const c = ps[ps.length - 1].cloneNode(true);
      body.appendChild(c);
      ps = kids(body, A, "p");
    }
    paras.forEach((parts, i) => setPara(ps[i], parts));
    for (const extra of ps.slice(paras.length)) body.removeChild(extra);
  }

  const orTodo = (v) => (v && String(v).trim() ? [[String(v).trim(), null]] : [[TODO, RED]]);
  const countText = (v) => {
    const n = String(v || "").replace(/[^\d]/g, "");
    return n ? [[`${Number(n).toLocaleString("en-US")}건`, null]] : [[TODO, RED]];
  };

  function shapeText(sp) {
    return all(sp, A, "t").map((t) => t.textContent).join("");
  }

  // ---------- 상세 슬라이드 채우기 ----------
  function fillDetail(doc, item, no, linkRid) {
    const spTree = all(doc, P, "spTree")[0];
    for (const n of [...spTree.childNodes]) {
      if (n.namespaceURI === P && (n.localName === "pic" || n.localName === "grpSp")) spTree.removeChild(n);
    }
    for (const sp of kids(spTree, P, "sp")) {
      const text = shapeText(sp).trim();
      const p = all(sp, A, "p")[0];
      if (!p) continue;
      if (text.startsWith("■")) setPara(p, [["■ ", null], [item.title, null]]);
      else if (/^No\.\s*\d+$/i.test(text)) setPara(p, `No.${no}`);
    }
    const tbl = all(doc, A, "tbl")[0];
    const rows = kids(tbl, A, "tr").map((tr) => kids(tr, A, "tc"));
    const cell = (r, c) => rows[r][c];
    setCell(cell(0, 1), orTodo(item.code));
    setCell(cell(0, 3), item.spec || "-");
    const lv = (name) => [name, item.level === name ? LEVEL_COLORS[name] : null];
    setCell(cell(0, 5), [[item.kind || "품질", null], ["(", null], lv("주의"), ["/", null], lv("경고"), ["/", null], lv("심각"), [")", null]]);
    setCell(cell(0, 7), item.progress || "초기");
    setCell(cell(1, 1), "동호회", orTodo(item.cafe));
    setCell(cell(1, 3), item.url);
    for (const h of all(cell(1, 3), A, "hlinkClick")) h.setAttributeNS(R, "r:id", linkRid);
    if (!all(cell(1, 3), A, "hlinkClick").length) {
      for (const rPr of all(cell(1, 3), A, "rPr")) {
        const h = doc.createElementNS(A, "a:hlinkClick");
        h.setAttributeNS(R, "r:id", linkRid);
        rPr.appendChild(h);
      }
    }
    setCell(cell(2, 5), countText(item.views));
    setCell(cell(2, 6), countText(item.commentCount));
    const reaction = (item.reaction || "").trim();
    setCell(
      cell(3, 1),
      orTodo(item.body),
      reaction ? [["댓글 반응 : ", null], [reaction, null]] : item.noReaction ? "댓글 반응 없음" : [["댓글 반응 : ", null], [TODO, RED]],
    );
  }

  function addPicture(doc, rid, pl, name) {
    const spTree = all(doc, P, "spTree")[0];
    const ids = all(doc, P, "cNvPr").map((e) => Number(e.getAttribute("id")) || 0);
    const id = Math.max(1, ...ids) + 1;
    const x = (v) => Math.round(v);
    const xml =
      `<p:pic xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:nvPicPr><p:cNvPr id="${id}" name="${name} ${id}"/>` +
      `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr><a:xfrm><a:off x="${x(pl.x)}" y="${x(pl.y)}"/><a:ext cx="${x(pl.w)}" cy="${x(pl.h)}"/></a:xfrm>` +
      `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    const node = doc.importNode(parse(xml).documentElement, true);
    spTree.appendChild(node);
    return node;
  }

  // 캡처 그림들을 하나로 묶기 (PowerPoint '그룹화'와 같음 → 한 번에 옮기고 크기 조절)
  function groupPictures(doc, nodes, pls) {
    if (nodes.length < 2) return;
    const spTree = all(doc, P, "spTree")[0];
    const ids = all(doc, P, "cNvPr").map((e) => Number(e.getAttribute("id")) || 0);
    const id = Math.max(1, ...ids) + 1;
    const x0 = Math.round(Math.min(...pls.map((p) => p.x)));
    const y0 = Math.round(Math.min(...pls.map((p) => p.y)));
    const x1 = Math.round(Math.max(...pls.map((p) => p.x + p.w)));
    const y1 = Math.round(Math.max(...pls.map((p) => p.y + p.h)));
    const xml =
      `<p:grpSp xmlns:p="${P}" xmlns:a="${A}"><p:nvGrpSpPr><p:cNvPr id="${id}" name="캡처 그룹 ${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
      `<p:grpSpPr><a:xfrm><a:off x="${x0}" y="${y0}"/><a:ext cx="${x1 - x0}" cy="${y1 - y0}"/>` +
      `<a:chOff x="${x0}" y="${y0}"/><a:chExt cx="${x1 - x0}" cy="${y1 - y0}"/></a:xfrm></p:grpSpPr></p:grpSp>`;
    const grp = doc.importNode(parse(xml).documentElement, true);
    spTree.insertBefore(grp, nodes[0]);
    for (const n of nodes) grp.appendChild(n);
  }

  // ---------- 전체 만들기 ----------
  // items: [{ title, code, spec, kind, level, progress, cafe, url, views, commentCount, body, reaction, noReaction,
  //           short, duplicate, region, focus, pictures: [{ blob, ext, x, y, w, h, name }] }]
  // startNo: 첫 글의 연번, totalRows: 요약표 칸 수 (startNo 앞 칸은 연번만 있는 빈 칸)
  async function build(templateBytes, { dateText, items, startNo = 1, totalRows = items.length }) {
    const files = await Zip.read(templateBytes);
    const pres = parse(files.get("ppt/presentation.xml"));
    const presRelsPath = "ppt/_rels/presentation.xml.rels";
    const presRels = parse(files.get(presRelsPath));
    const ct = parse(files.get("[Content_Types].xml"));
    const relById = new Map(all(presRels, PR, "Relationship").map((r) => [r.getAttribute("Id"), r]));
    const sldIdLst = all(pres, P, "sldIdLst")[0];
    const sldIds = kids(sldIdLst, P, "sldId");
    const slidePaths = sldIds.map((s) => resolve("ppt/presentation.xml", relById.get(s.getAttributeNS(R, "id")).getAttribute("Target")));
    if (slidePaths.length < 4) throw new Error("템플릿에 상세 슬라이드(4장)가 없습니다. 완성된 보고서 PPT 를 템플릿으로 넣어 주세요.");

    const protoPath = slidePaths[3];
    const protoXml = Zip.text(files.get(protoPath));
    const protoRels = Zip.text(files.get(relsPath(protoPath)));

    // 4장부터 지우기 (노트 포함)
    const removeOverride = (part) => {
      for (const o of all(ct, CT, "Override")) if (o.getAttribute("PartName") === `/${part}`) o.parentNode.removeChild(o);
    };
    sldIds.slice(3).forEach((sid, k) => {
      const path = slidePaths[k + 3];
      const rp = relsPath(path);
      if (files.has(rp)) {
        for (const r of all(parse(files.get(rp)), PR, "Relationship")) {
          if (r.getAttribute("Type") === T_NOTES) {
            const np = resolve(path, r.getAttribute("Target"));
            files.delete(np);
            files.delete(relsPath(np));
            removeOverride(np);
          }
        }
      }
      files.delete(path);
      files.delete(rp);
      removeOverride(path);
      const rid = sid.getAttributeNS(R, "id");
      relById.get(rid).parentNode.removeChild(relById.get(rid));
      sldIdLst.removeChild(sid);
    });

    // 표지·요약표 날짜
    for (const path of slidePaths.slice(0, 2)) {
      const d = parse(files.get(path));
      for (const t of all(d, A, "t")) t.textContent = t.textContent.replace(/\d{4}\.\d{1,2}\.\d{1,2}/, dateText);
      files.set(path, ser(d));
    }

    // 요약표
    {
      const path = slidePaths[1];
      const d = parse(files.get(path));
      const tbl = all(d, A, "tbl")[0];
      const trs = kids(tbl, A, "tr");
      const proto = trs[1];
      for (const tr of trs.slice(1)) tbl.removeChild(tr);
      const byNo = new Map(items.map((it, i) => [it.no || startNo + i, it]));
      // 복제한 행마다 PowerPoint 행 ID(a16:rowId)를 새로 매긴다. 같으면 PowerPoint 가 표를 손상된 것으로 보고
      // 글자 수정·크기 조절이 안 된다.
      const usedIds = new Set(all(tbl, "http://schemas.microsoft.com/office/drawing/2014/main", "rowId").map((e) => e.getAttribute("val")));
      const newRowId = () => {
        let v;
        do v = String(Math.floor(Math.random() * 4294967295)); while (usedIds.has(v));
        usedIds.add(v);
        return v;
      };
      for (let no = 1; no <= Math.max(totalRows, ...byNo.keys()); no++) {
        const it = byNo.get(no);
        const tr = proto.cloneNode(true);
        for (const rid of all(tr, "http://schemas.microsoft.com/office/drawing/2014/main", "rowId")) rid.setAttribute("val", newRowId());
        const tcs = kids(tr, A, "tc");
        setCell(tcs[0], String(no));
        if (!it) {
          for (const tc of tcs.slice(1)) setCell(tc, "");
          tbl.appendChild(tr);
          continue;
        }
        setCell(tcs[1], orTodo(it.code));
        setCell(tcs[2], it.kind || "품질");
        setCell(tcs[3], orTodo(it.short));
        setCell(tcs[4], countText(it.commentCount).map(([t, c]) => [c ? "확인" : t.replace("건", ""), c]));
        setCell(tcs[5], orTodo(it.duplicate));
        setCell(tcs[6], it.region || "-");
        setCell(tcs[7], it.focus || "-");
        tbl.appendChild(tr);
      }
      // 칸 수(8·10·12개 …)와 상관없이 표 아래 끝선이 템플릿 표와 같은 위치에 오도록
      // 표 틀 높이에서 머리글 행을 뺀 만큼을 데이터 행에 똑같이 나눈다
      let frame = tbl.parentNode;
      while (frame && frame.localName !== "graphicFrame") frame = frame.parentNode;
      const ext = frame && all(frame, A, "ext").find((e) => e.parentNode.localName === "xfrm");
      const rowsNow = kids(tbl, A, "tr");
      if (ext && rowsNow.length > 1) {
        const frameH = Number(ext.getAttribute("cy"));
        const headH = Number(rowsNow[0].getAttribute("h"));
        const each = Math.floor((frameH - headH) / (rowsNow.length - 1));
        if (each > 0) rowsNow.slice(1).forEach((tr) => tr.setAttribute("h", String(each)));
      }
      files.set(path, ser(d));
    }

    // 상세 슬라이드
    const used = new Set([...files.keys()]);
    const nextName = (pattern) => {
      for (let n = 1; ; n++) {
        const name = pattern.replace("#", n);
        if (!used.has(name)) {
          used.add(name);
          return name;
        }
      }
    };
    let maxSldId = Math.max(255, ...kids(sldIdLst, P, "sldId").map((s) => Number(s.getAttribute("id"))));
    const presRelsRoot = presRels.documentElement;
    const ctRoot = ct.documentElement;
    const defaults = new Set(all(ct, CT, "Default").map((d) => d.getAttribute("Extension").toLowerCase()));
    for (const [ext, type] of [["png", "image/png"], ["jpeg", "image/jpeg"]]) {
      if (!defaults.has(ext)) {
        const d = ct.createElementNS(CT, "Default");
        d.setAttribute("Extension", ext);
        d.setAttribute("ContentType", type);
        ctRoot.insertBefore(d, ctRoot.firstChild);
      }
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const slidePath = nextName("ppt/slides/slide#.xml");
      const doc = parse(protoXml);
      const rels = parse(protoRels);
      const relRoot = rels.documentElement;
      for (const r of all(rels, PR, "Relationship")) {
        if ([T_IMAGE, T_LINK, T_NOTES].includes(r.getAttribute("Type"))) relRoot.removeChild(r);
      }
      let ridN = 100;
      const addRel = (type, target, external) => {
        const r = rels.createElementNS(PR, "Relationship");
        const id = `rId${ridN++}`;
        r.setAttribute("Id", id);
        r.setAttribute("Type", type);
        r.setAttribute("Target", target);
        if (external) r.setAttribute("TargetMode", "External");
        relRoot.appendChild(r);
        return id;
      };
      const linkRid = addRel(T_LINK, it.url, true);
      fillDetail(doc, it, it.no || startNo + i, linkRid);
      const picNodes = [];
      for (const pic of it.pictures || []) {
        const media = nextName(`ppt/media/report_${i + 1}_#.${pic.ext}`);
        files.set(media, new Uint8Array(await pic.blob.arrayBuffer()));
        const rid = addRel(T_IMAGE, `../media/${media.split("/").pop()}`);
        picNodes.push(addPicture(doc, rid, pic, pic.name || "그림"));
      }
      groupPictures(doc, picNodes, it.pictures || []);
      files.set(slidePath, ser(doc));
      files.set(relsPath(slidePath), ser(rels));

      const o = ct.createElementNS(CT, "Override");
      o.setAttribute("PartName", `/${slidePath}`);
      o.setAttribute("ContentType", SLIDE_CT);
      ctRoot.appendChild(o);
      const pr = presRels.createElementNS(PR, "Relationship");
      const prId = `rIdRpt${i + 1}`;
      pr.setAttribute("Id", prId);
      pr.setAttribute("Type", T_SLIDE);
      pr.setAttribute("Target", `slides/${slidePath.split("/").pop()}`);
      presRelsRoot.appendChild(pr);
      const sid = pres.createElementNS(P, "p:sldId");
      sid.setAttribute("id", String(++maxSldId));
      sid.setAttributeNS(R, "r:id", prId);
      sldIdLst.appendChild(sid);
    }

    files.set("ppt/presentation.xml", ser(pres));
    files.set(presRelsPath, ser(presRels));
    files.set("[Content_Types].xml", ser(ct));

    // 지운 슬라이드만 쓰던 그림 파일 정리
    const referenced = new Set();
    for (const [name, data] of files) {
      if (!name.endsWith(".rels")) continue;
      const owner = name.replace(/_rels\/([^/]+)\.rels$/, "$1");
      for (const r of all(parse(data), PR, "Relationship")) {
        if (r.getAttribute("TargetMode") === "External") continue;
        referenced.add(resolve(owner, r.getAttribute("Target")));
      }
    }
    for (const name of [...files.keys()]) {
      if (name.startsWith("ppt/media/") && !referenced.has(name)) files.delete(name);
    }

    // 문서 속성의 슬라이드 수
    if (files.has("docProps/app.xml")) {
      const app = Zip.text(files.get("docProps/app.xml")).replace(/<Slides>\d+<\/Slides>/, `<Slides>${3 + items.length}</Slides>`);
      files.set("docProps/app.xml", app);
    }
    return Zip.write(files);
  }

  global.Pptx = { build };
})(typeof window !== "undefined" ? window : self);
