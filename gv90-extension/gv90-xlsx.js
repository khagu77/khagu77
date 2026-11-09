// GV90 엑셀 만들기·읽기 (외부 라이브러리 없음)
// 양식: 온라인 오전 일일동향 '차종별 온라인 동향 RAW data' 의 '제네시스' 시트와 같은 모양
//   A 연번 · B 커뮤니티명 · C 차종 · D 게시일(mm월 dd일) · E 구분 · F 게시글 위치(하이퍼링크) · G 주요 내용 · H 성향(추가)
//   서식(글꼴 현대산스 Text·테두리·머리글 색·날짜 형식)은 일일동향 보고서 양식(report-template.js) 그대로 쓰고,
//   성향 글자색(긍정 파랑 · 중립 초록 · 부정 빨강 · 단순비난 진한 노랑)만 서식을 덧붙였다.
// 시트를 더 붙일 수 있게(댓글·일자별 집계) 시트마다 열 정의를 받는다.
(function (global) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (b) => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  function zip(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let pos = 0;
    for (const p of all) {
      out.set(p, pos);
      pos += p.length;
    }
    return out;
  }

  const esc = (s) =>
    String(s)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, "")
      .slice(0, 32767)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  function colName(n) {
    let s = "";
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  // ------------------------------------------------------------- 서식: 일일동향 양식 + 성향 글자색 4개
  // 양식 셀 서식 번호: 5 머리글 · 3 가운데 · 4 게시일(mm월 dd일) · 7 링크 · 9 주요 내용 · 8 주요 내용(노란색)
  const S = { head: 5, center: 3, date: 4, link: 7, text: 9, yellow: 8, pos: 14, neu: 15, neg: 16, blame: 17 };
  const SENTI_S = { 긍정: "pos", 중립: "neu", 부정: "neg", 단순비난: "blame" };
  function stylesXml() {
    const base = typeof TEMPLATE_STYLES_XML !== "undefined" ? TEMPLATE_STYLES_XML : global.TEMPLATE_STYLES_XML; // report-template.js (const 라 window 에 붙지 않음)
    const colors = ["FF1F6FD1", "FF16A34A", "FFE0201B", "FFB8860B"]; // 긍정 파랑 · 중립 초록 · 부정 빨강 · 단순비난 진한 노랑
    const fonts = colors.map((c) => `<font><b/><sz val="10"/><color rgb="${c}"/><name val="현대산스 Text"/><family val="3"/><charset val="129"/></font>`).join("");
    const xfs = colors.map((_, i) => `<xf numFmtId="0" fontId="${8 + i}" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`).join("");
    return base
      .replace(/<fonts count="8"([^>]*)>([\s\S]*?)<\/fonts>/, (all, attrs, inner) => `<fonts count="12"${attrs}>${inner}${fonts}</fonts>`)
      .replace(/<cellXfs count="14">([\s\S]*?)<\/cellXfs>/, (all, inner) => `<cellXfs count="18">${inner}${xfs}</cellXfs>`);
  }

  // excelSerial: 날짜만 (시각 버림)
  const serialDay = (d) => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);

  // sheet: { name, columns: [{ header, width, style, link? }], rows: [[값…]], cellStyle?(ri, ci, v) → 서식 이름, cursorEnd? }
  function sheetXml(sheet, selected) {
    const cols = sheet.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 12}" customWidth="1"/>`).join("");
    const links = [];
    const cell = (ref, v, sname) => {
      const s = S[sname] ?? S.center;
      if (v === null || v === undefined || v === "") return `<c r="${ref}" s="${s}"/>`;
      if (v instanceof Date) return `<c r="${ref}" s="${s}"><v>${serialDay(v)}</v></c>`;
      if (typeof v === "number" && isFinite(v)) return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
      return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    };
    let data = `<row r="1">${sheet.columns.map((c, i) => cell(`${colName(i + 1)}1`, c.header, "head")).join("")}</row>`;
    sheet.rows.forEach((row, ri) => {
      const r = ri + 2;
      data += `<row r="${r}">${sheet.columns
        .map((col, ci) => {
          const v = row[ci];
          const ref = `${colName(ci + 1)}${r}`;
          if (col.link && /^https?:\/\//i.test(String(v || ""))) links.push({ ref, url: String(v) });
          return cell(ref, v, (sheet.cellStyle && sheet.cellStyle(ri, ci, v)) || col.style);
        })
        .join("")}</row>`;
    });
    const lastRow = sheet.rows.length + 1;
    const last = `${colName(sheet.columns.length)}${lastRow}`;
    // 커서: 마지막 행 바로 아래 A열 (일일동향 RAW 처럼 다시 열면 바로 이어서 입력)
    const next = lastRow + 1;
    const xml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<dimension ref="A1:${last}"/>` +
      `<sheetViews><sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ""}${sheet.cursorEnd ? ` topLeftCell="A${Math.max(1, next - 20)}"` : ""}><selection activeCell="A${sheet.cursorEnd ? next : 1}" sqref="A${sheet.cursorEnd ? next : 1}"/></sheetView></sheetViews>` +
      '<sheetFormatPr defaultRowHeight="17.399999999999999"/>' +
      `<cols>${cols}</cols><sheetData>${data}</sheetData>` +
      (sheet.filter && sheet.rows.length ? `<autoFilter ref="A1:${last}"/>` : "") +
      (links.length ? `<hyperlinks>${links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rId${i + 1}"/>`).join("")}</hyperlinks>` : "") +
      '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
    const rels = links.length
      ? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        links.map((l, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(l.url)}" TargetMode="External"/>`).join("") +
        "</Relationships>"
      : null;
    return { xml, rels, last };
  }

  function build(sheets) {
    const built = sheets.map((s, i) => sheetXml(s, i === 0));
    const files = [
      {
        name: "[Content_Types].xml",
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
          sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
          "</Types>",
      },
      {
        name: "_rels/.rels",
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      },
      {
        name: "xl/workbook.xml",
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          `<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 3}"/>`).join("")}</sheets>` +
          (sheets.some((s) => s.filter && s.rows.length)
            ? `<definedNames>${sheets
                .map((s, i) => (s.filter && s.rows.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name)}'!$A$1:$${built[i].last.replace(/(\d+)$/, "$$$1")}</definedName>` : ""))
                .join("")}</definedNames>`
            : "") +
          "</workbook>",
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' +
          sheets.map((_, i) => `<Relationship Id="rId${i + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
          "</Relationships>",
      },
      { name: "xl/styles.xml", data: stylesXml() },
      { name: "xl/theme/theme1.xml", data: typeof TEMPLATE_THEME_XML !== "undefined" ? TEMPLATE_THEME_XML : global.TEMPLATE_THEME_XML },
    ];
    built.forEach((b, i) => {
      files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: b.xml });
      if (b.rels) files.push({ name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data: b.rels });
    });
    return zip(files);
  }

  // ------------------------------------------------------------- GV90 raw data 양식
  const RAW_SHEET = "제네시스";
  const RAW_COLUMNS = [
    { header: "연번", width: 7.5, style: "center" }, // A
    { header: "커뮤니티명", width: 18.5, style: "center" }, // B
    { header: "차종", width: 9, style: "center" }, // C
    { header: "게시일", width: 9.2, style: "date" }, // D (mm월 dd일)
    { header: "구분", width: 9.5, style: "center" }, // E
    { header: "게시글 위치", width: 60, style: "link", link: true }, // F
    { header: "주요 내용", width: 80, style: "text" }, // G
    { header: "성향", width: 9.5, style: "center" }, // H (추가)
  ];
  const COMMENT_COLUMNS = [
    { header: "연번", width: 7.5, style: "center" },
    { header: "커뮤니티명", width: 18.5, style: "center" },
    { header: "차종", width: 9, style: "center" },
    { header: "작성일", width: 9.2, style: "date" },
    { header: "구분", width: 9.5, style: "center" },
    { header: "게시글 위치", width: 60, style: "link", link: true },
    { header: "댓글", width: 80, style: "text" },
    { header: "성향", width: 9.5, style: "center" },
  ];
  const sentiStyle = (col) => (ri, ci, v) => (ci === col ? SENTI_S[v] : null);
  const asDate = (ms) => (ms ? new Date(ms) : null);

  // posts: 연번 순 게시물 · comments: 있으면 '댓글' 시트 · daily: 일자별 집계(데일리 DB days)
  function buildRaw({ posts, comments = [], daily = null }) {
    const sheets = [
      {
        name: RAW_SHEET,
        columns: RAW_COLUMNS,
        cursorEnd: true,
        rows: posts.map((p, i) => [p.serial || i + 1, p.media || "", p.car || "GV90", asDate(p.date), p.category || "", p.url, p.summary || p.title || "", p.sentiment || ""]),
        cellStyle: sentiStyle(7),
      },
    ];
    if (comments.length) {
      sheets.push({
        name: "댓글",
        columns: COMMENT_COLUMNS,
        cursorEnd: true,
        rows: comments.map((c, i) => [c.serial || i + 1, c.media || "", c.car || "GV90", asDate(c.date), c.category || "", c.url, c.text || "", c.sentiment || ""]),
        cellStyle: sentiStyle(7),
      });
    }
    if (daily && daily.length) {
      const SENT = ["긍정", "중립", "부정", "단순비난"];
      const CH = ["언론", "유튜브", "동호회", "자동차 커뮤니티"];
      sheets.push({
        name: "일자별 집계",
        filter: true,
        columns: [
          { header: "보고일", width: 12, style: "center" },
          { header: "게시물", width: 9, style: "center" },
          ...CH.map((c) => ({ header: c, width: 10, style: "center" })),
          ...SENT.map((s) => ({ header: s, width: 9, style: "center" })),
          { header: "부정+단순비난", width: 13, style: "center" },
        ],
        rows: daily.map((d) => {
          const s = d.stats || {};
          const bad = (s.bySentiment?.부정 || 0) + (s.bySentiment?.단순비난 || 0);
          return [
            `${d.day.slice(0, 4)}-${d.day.slice(4, 6)}-${d.day.slice(6, 8)}`,
            s.posts || 0,
            ...CH.map((c) => s.byChannel?.[c] || 0),
            ...SENT.map((x) => s.bySentiment?.[x] || 0),
            s.posts ? `${Math.round((bad / s.posts) * 100)}%` : "-",
          ];
        }),
      });
    }
    return build(sheets);
  }

  // 댓글 raw data: '댓글' 시트(게시물 양식과 같은 열 + 댓글) · '게시글별 댓글 성향' 시트
  function buildComments({ comments, posts }) {
    const SENT = ["긍정", "중립", "부정", "단순비난"];
    const byPost = new Map();
    for (const c of comments) {
      if (!byPost.has(c.postKey)) byPost.set(c.postKey, []);
      byPost.get(c.postKey).push(c);
    }
    const postOf = new Map((posts || []).map((p) => [p.key, p]));
    const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "-");
    const sheets = [
      {
        name: "댓글",
        columns: COMMENT_COLUMNS,
        cursorEnd: true,
        filter: true,
        rows: comments.map((c, i) => [i + 1, c.media || "", c.car || "GV90", asDate(c.date), c.category || "", c.url, c.text || "", c.sentiment || ""]),
        cellStyle: sentiStyle(7),
      },
      {
        name: "게시글별 댓글 성향",
        filter: true,
        columns: [
          { header: "커뮤니티명", width: 18.5, style: "center" },
          { header: "게시글 위치", width: 50, style: "link", link: true },
          { header: "주요 내용", width: 50, style: "text" },
          { header: "댓글", width: 8, style: "center" },
          ...SENT.map((s) => ({ header: s, width: 9, style: "center" })),
          { header: "부정+단순비난", width: 12, style: "center" },
        ],
        rows: [...byPost.entries()].map(([k, list]) => {
          const p = postOf.get(k) || list[0];
          const n = list.length;
          const cnt = (s) => list.filter((c) => c.sentiment === s).length;
          return [p.media || "", p.url, p.summary || p.title || "", n, ...SENT.map((s) => pct(cnt(s), n)), pct(cnt("부정") + cnt("단순비난"), n)];
        }),
      },
    ];
    return build(sheets);
  }

  // ------------------------------------------------------------- 읽기 (기존 raw data 등록 · 수정본 올리기)
  // 머리글(커뮤니티명·주요 내용)을 찾아 열을 맞추므로 일일동향 보고서 양식·RAW 양식·이 프로그램 양식 모두 읽는다
  async function readZip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("엑셀(.xlsx) 파일이 아니거나 손상된 파일입니다.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = new Map();
    for (let i = 0; i < count; i++) {
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true);
      const xlen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      files.set(name, { method, raw: bytes.subarray(start, start + csize) });
      p += 46 + nlen + xlen + clen;
    }
    return async (n) => {
      const f = files.get(n);
      if (!f) return null;
      if (f.method === 0) return dec.decode(f.raw);
      const out = new Response(new Blob([f.raw]).stream().pipeThrough(new DecompressionStream("deflate-raw")));
      return dec.decode(new Uint8Array(await out.arrayBuffer()));
    };
  }

  async function read(bytes) {
    const text = await readZip(bytes);
    const xml = (t) => new DOMParser().parseFromString(t, "application/xml");
    const kids = (el, name) => [...el.getElementsByTagName(name)];
    const shared = [];
    const ss = await text("xl/sharedStrings.xml");
    if (ss) for (const si of kids(xml(ss), "si")) shared.push(kids(si, "t").map((t) => t.textContent).join(""));
    const wb = xml(await text("xl/workbook.xml"));
    const rels = xml(await text("xl/_rels/workbook.xml.rels"));
    const target = {};
    for (const r of kids(rels, "Relationship")) target[r.getAttribute("Id")] = r.getAttribute("Target");
    const colIndex = (ref) => {
      let n = 0;
      for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + (ch.charCodeAt(0) - 64);
      return n - 1;
    };
    const out = [];
    for (const sh of kids(wb, "sheet")) {
      const sheetName = sh.getAttribute("name");
      if (/일자별|집계/.test(sheetName)) continue;
      const rid = sh.getAttribute("r:id") || sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      let path = target[rid] || "";
      path = path.startsWith("/") ? path.slice(1) : `xl/${path.replace(/^\.\//, "")}`;
      const t = await text(path);
      if (!t) continue;
      const doc = xml(t);
      // 하이퍼링크 (칸 글자가 주소가 아닐 때)
      const relText = await text(path.replace(/worksheets\/(sheet\d+\.xml)$/, "worksheets/_rels/$1.rels"));
      const linkTarget = {};
      if (relText) for (const r of kids(xml(relText), "Relationship")) linkTarget[r.getAttribute("Id")] = r.getAttribute("Target");
      const links = {};
      for (const h of kids(doc, "hyperlink")) {
        const id = h.getAttribute("r:id") || h.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
        if (linkTarget[id]) links[h.getAttribute("ref")] = linkTarget[id];
      }
      const grid = [];
      for (const row of kids(doc, "row")) {
        const r = +row.getAttribute("r") - 1;
        const cells = (grid[r] = []);
        for (const c of kids(row, "c")) {
          const ref = c.getAttribute("r");
          const ci = colIndex(ref);
          const ty = c.getAttribute("t");
          const v = c.getElementsByTagName("v")[0];
          let val = null;
          if (ty === "s" && v) val = shared[+v.textContent];
          else if (ty === "inlineStr") val = kids(c, "t").map((x) => x.textContent).join("");
          else if (v) val = ty === "str" ? v.textContent : +v.textContent;
          cells[ci] = { val, link: links[ref] || null };
        }
      }
      let hr = -1;
      let col = null;
      for (let r = 0; r < Math.min(grid.length, 10) && hr < 0; r++) {
        const row = grid[r] || [];
        const find = (...names) => row.findIndex((c) => c && names.includes(String(c.val || "").trim()));
        if (find("커뮤니티명") >= 0 && find("주요 내용", "댓글") >= 0) {
          hr = r;
          const cat = find("구분");
          const pos = find("게시글 위치", "URL");
          col = { serial: find("연번", "No"), community: find("커뮤니티명"), car: find("차종"), date: find("게시일", "작성일"), category: cat, url: pos >= 0 ? pos : cat + 1, summary: find("주요 내용", "댓글"), sentiment: find("성향") };
        }
      }
      if (hr < 0) continue;
      for (let r = hr + 1; r < grid.length; r++) {
        const row = grid[r];
        if (!row) continue;
        const get = (i) => (i >= 0 && row[i] ? row[i].val : null);
        const urlCell = col.url >= 0 ? row[col.url] : null;
        const url = String((urlCell && (urlCell.link || urlCell.val)) || "").trim();
        const community = String(get(col.community) ?? "").trim();
        if (!community && !url) continue;
        const dv = get(col.date);
        let date = null;
        if (typeof dv === "number") {
          const d = new Date(Date.UTC(1899, 11, 30) + Math.round(dv * 86400000));
          date = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        } else if (dv) {
          const m = String(dv).match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
          if (m) date = new Date(+m[1], +m[2] - 1, +m[3]);
        }
        out.push({
          sheet: sheetName,
          serial: typeof get(col.serial) === "number" ? get(col.serial) : null,
          community,
          car: String(get(col.car) ?? "").trim(),
          date,
          category: String(get(col.category) ?? "").trim(),
          url,
          summary: String(get(col.summary) ?? "").trim(),
          sentiment: String(get(col.sentiment) ?? "").trim(),
          isComment: sheetName === "댓글",
        });
      }
    }
    return out;
  }

  global.Gv90Xlsx = { build, buildRaw, buildComments, read, RAW_SHEET, RAW_COLUMNS };
})(typeof window !== "undefined" ? window : globalThis);
