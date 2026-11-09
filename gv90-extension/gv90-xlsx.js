// GV90 엑셀 만들기 (외부 라이브러리 없음): '온라인 오전 일일동향' 부정 이슈 게시물 raw data 양식
//   시트 '제네시스' · 1행 머리글: A (연번, 머리글 빈칸) · B 커뮤니티명 · C 차종 · D 게시일 · E 구분 · F 게시글 위치 · G 주요 내용 · H 성향
//   (H 성향만 새로 붙임 · 게시글 위치는 누르면 열리는 링크 · 성향은 긍정 파랑 / 중립 회색 / 부정 빨강 / 단순비난 보라)
// 시트를 더 붙일 수 있게(댓글 등) 시트마다 열 정의를 받는 일반 작성기 + 양식별 함수로 나눔.
(function (global) {
  const enc = new TextEncoder();
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

  // ------------------------------------------------------------- 서식
  // 서식 이름 → cellXfs 번호
  const XF = { normal: 0, head: 1, text: 2, wrap: 3, date: 4, center: 5, link: 6, pos: 7, neu: 8, neg: 9, blame: 10, num: 11, datetime: 12 };
  const SENTI_XF = { 긍정: "pos", 중립: "neu", 부정: "neg", 단순비난: "blame" };
  const FONT = "맑은 고딕";

  function stylesXml() {
    const font = (extra = "", color = "") => `<font>${extra}<sz val="10"/>${color ? `<color rgb="${color}"/>` : ""}<name val="${FONT}"/><charset val="129"/></font>`;
    const fonts = [
      font(), // 0 기본
      font("<b/>", "FFFFFFFF"), // 1 머리글
      font("<u/>", "FF1F5FBF"), // 2 링크
      font("<b/>", "FF2A78D6"), // 3 긍정
      font("<b/>", "FF6E6D69"), // 4 중립
      font("<b/>", "FFD0302F"), // 5 부정
      font("<b/>", "FF6250D6"), // 6 단순비난
    ];
    const border = '<border><left style="thin"><color rgb="FFBFC5D2"/></left><right style="thin"><color rgb="FFBFC5D2"/></right><top style="thin"><color rgb="FFBFC5D2"/></top><bottom style="thin"><color rgb="FFBFC5D2"/></bottom><diagonal/></border>';
    const xf = (fontId, { fill = 0, numFmt = 0, h = "", wrap = false } = {}) =>
      `<xf numFmtId="${numFmt}" fontId="${fontId}" fillId="${fill}" borderId="1" xfId="0" applyFont="1" applyBorder="1"${fill ? ' applyFill="1"' : ""}${numFmt ? ' applyNumberFormat="1"' : ""} applyAlignment="1"><alignment vertical="center"${h ? ` horizontal="${h}"` : ""}${wrap ? ' wrapText="1"' : ""}/></xf>`;
    const xfs = [
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', // normal
      xf(1, { fill: 2, h: "center", wrap: true }), // head
      xf(0), // text
      xf(0, { wrap: true }), // wrap
      xf(0, { numFmt: 164, h: "center" }), // date
      xf(0, { h: "center" }), // center
      xf(2), // link
      xf(3, { h: "center" }), // pos
      xf(4, { h: "center" }), // neu
      xf(5, { h: "center" }), // neg
      xf(6, { h: "center" }), // blame
      xf(0, { numFmt: 3, h: "center" }), // num
      xf(0, { numFmt: 165, h: "center" }), // datetime
    ];
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/></numFmts>' +
      `<fonts count="${fonts.length}">${fonts.join("")}</fonts>` +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF0B1F4B"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${border}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      "</styleSheet>"
    );
  }

  // ------------------------------------------------------------- 시트
  // sheet: { name, columns: [{ header, width, style, link?: true }], rows: [[값...]], cellStyle?(ri, ci, v) → 서식 이름 }
  // 값: 문자열 · 숫자 · Date(날짜 칸) · null
  function excelSerial(d) {
    return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) - Date.UTC(1899, 11, 30)) / 86400000;
  }

  function sheetXml(sheet) {
    const ncols = sheet.columns.length;
    const cols = sheet.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 14}" customWidth="1"/>`).join("");
    const links = [];
    let data = `<row r="1" ht="24" customHeight="1">${sheet.columns
      .map((c, i) => `<c r="${colName(i + 1)}1" s="${XF.head}"${c.header ? ` t="inlineStr"><is><t>${esc(c.header)}</t></is></c>` : "/>"}`)
      .join("")}</row>`;
    sheet.rows.forEach((row, ri) => {
      const r = ri + 2;
      let cells = "";
      sheet.columns.forEach((col, ci) => {
        let v = row[ci];
        const ref = colName(ci + 1) + r;
        const sname = (sheet.cellStyle && sheet.cellStyle(ri, ci, v)) || col.style || "text";
        const s = XF[sname] ?? XF.text;
        if (v === null || v === undefined || v === "") {
          cells += `<c r="${ref}" s="${s}"/>`;
          return;
        }
        if (v instanceof Date) v = excelSerial(v);
        if (typeof v === "number" && isFinite(v)) cells += `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
        else cells += `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        if (col.link && /^https?:\/\//i.test(String(v))) links.push({ ref, url: String(v) });
      });
      data += `<row r="${r}">${cells}</row>`;
    });
    const last = colName(ncols) + Math.max(1, sheet.rows.length + 1);
    const hl = links.length ? `<hyperlinks>${links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rIdL${i + 1}"/>`).join("")}</hyperlinks>` : "";
    // 커서를 마지막 행 바로 아래에 (이어 쓰기 편하게)
    const nextRow = sheet.rows.length + 2;
    const xml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<dimension ref="A1:${last}"/>` +
      `<sheetViews><sheetView workbookViewId="0"${sheet.selected ? ' tabSelected="1"' : ""}><pane ySplit="1" topLeftCell="A${Math.max(2, nextRow - 25)}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${nextRow}" sqref="A${nextRow}"/></sheetView></sheetViews>` +
      '<sheetFormatPr defaultRowHeight="16.5"/>' +
      `<cols>${cols}</cols><sheetData>${data}</sheetData>` +
      `<autoFilter ref="A1:${last}"/>` +
      hl +
      "</worksheet>";
    const rels = links.length
      ? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        links.map((l, i) => `<Relationship Id="rIdL${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(l.url)}" TargetMode="External"/>`).join("") +
        "</Relationships>"
      : null;
    return { xml, rels, last };
  }

  function build(sheets) {
    const files = [];
    const built = sheets.map((s, i) => sheetXml({ ...s, selected: i === 0 }));
    files.push({
      name: "[Content_Types].xml",
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
        "</Types>",
    });
    files.push({
      name: "_rels/.rels",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    });
    files.push({
      name: "xl/workbook.xml",
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
        `<definedNames>${built.map((b, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(sheets[i].name)}'!$A$1:$${b.last.replace(/(\d+)$/, "$$$1")}</definedName>`).join("")}</definedNames>` +
        "</workbook>",
    });
    files.push({
      name: "xl/_rels/workbook.xml.rels",
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    });
    files.push({ name: "xl/styles.xml", data: stylesXml() });
    built.forEach((b, i) => {
      files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: b.xml });
      if (b.rels) files.push({ name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data: b.rels });
    });
    return zip(files);
  }

  // ------------------------------------------------------------- 양식
  const RAW_SHEET = "제네시스";
  const RAW_COLUMNS = [
    { header: "", width: 7, style: "num" }, // A 연번 (일일동향 raw data 양식처럼 머리글 빈칸)
    { header: "커뮤니티명", width: 20, style: "text" }, // B
    { header: "차종", width: 9, style: "center" }, // C
    { header: "게시일", width: 12, style: "date" }, // D
    { header: "구분", width: 11, style: "center" }, // E
    { header: "게시글 위치", width: 46, style: "link", link: true }, // F
    { header: "주요 내용", width: 60, style: "wrap" }, // G
    { header: "성향", width: 10, style: "center" }, // H (추가)
  ];
  const COMMENT_COLUMNS = [
    { header: "", width: 7, style: "num" },
    { header: "커뮤니티명", width: 20, style: "text" },
    { header: "차종", width: 9, style: "center" },
    { header: "작성일", width: 16, style: "datetime" },
    { header: "구분", width: 11, style: "center" },
    { header: "게시글 위치", width: 46, style: "link", link: true },
    { header: "댓글", width: 60, style: "wrap" },
    { header: "성향", width: 10, style: "center" },
  ];
  const dayOnly = (ms) => {
    if (!ms) return null;
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  };
  const sentiStyle = (col) => (ri, ci, v) => (ci === col ? SENTI_XF[v] : null);

  // posts: DB 게시물(연번 순) · comments: 있으면 '댓글' 시트를 붙임 · daily: [{ day, posts, byChannel..., bySentiment }] 집계 시트
  function buildRaw({ posts, comments = [], daily = null }) {
    const sheets = [
      {
        name: RAW_SHEET,
        columns: RAW_COLUMNS,
        rows: posts.map((p, i) => [i + 1, p.media || p.channel || "", p.car || "GV90", dayOnly(p.date), p.category || "", p.url, p.summary || p.title || "", p.sentiment || ""]),
        cellStyle: sentiStyle(7),
      },
    ];
    if (comments.length) {
      sheets.push({
        name: "댓글",
        columns: COMMENT_COLUMNS,
        rows: comments.map((c, i) => [i + 1, c.media || c.channel || "", c.car || "GV90", c.date ? new Date(c.date) : null, c.category || "", c.url, c.text || "", c.sentiment || ""]),
        cellStyle: sentiStyle(7),
      });
    }
    if (daily && daily.length) {
      const SENT = ["긍정", "중립", "부정", "단순비난"];
      const CH = ["언론", "유튜브", "동호회", "자동차 커뮤니티"];
      sheets.push({
        name: "일자별 집계",
        columns: [
          { header: "수집일", width: 12, style: "center" },
          { header: "게시물", width: 9, style: "num" },
          ...CH.map((c) => ({ header: c, width: 11, style: "num" })),
          ...SENT.map((s) => ({ header: s, width: 9, style: "num" })),
          { header: "부정+단순비난 비율", width: 12, style: "center" },
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

  global.Gv90Xlsx = { build, buildRaw, RAW_SHEET, RAW_COLUMNS };
})(typeof window !== "undefined" ? window : globalThis);
