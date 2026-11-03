// 외부 라이브러리 없이 .xlsx 파일을 만드는 작은 도구 (코세페 반응 모니터링 엑셀용).
// XlsxBook.build(sheets, { font }) → Uint8Array
//   sheet = { name, rows: [[값 | { v: 값, s: 서식 이름 }, ...], ...], widths: { 열번호(1부터): 너비 },
//             heights: { 행번호: 높이 }, merges: ["B2:H2"], freeze: 머리글 행 번호, filter: "B3:K3" }
//   빈 값(null·undefined·"")은 칸을 비운다. 숫자는 숫자 칸, 글자는 글자 칸.
//   서식 이름: STYLE_NAMES 참고 (head 머리글 · cell 테두리 · wrap 줄바꿈 · center 가운데 · pct 백분율 · date 날짜 ·
//              tone-긍정/중립/부정/단순비난 여론 글자색 · title 큰 제목 · sub 회색 소제목 · note 설명 글)
(function (global) {
  const enc = new TextEncoder();

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // 무압축(store) ZIP
  function zip(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      parts.push(new Uint8Array(local.buffer), name, data);
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

  function esc(s) {
    return String(s)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, "")
      .slice(0, 32767)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function colName(n) {
    let s = "";
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  // 여론 글자색 (MX5 F/L 가격 여론 수집기와 같은 색)
  const TONE_COLORS = { 긍정: "FF0070C0", 중립: "FF00B050", 부정: "FFE00000", 단순비난: "FFBF8F00" };
  const NAVY = "FF002C5F";

  // [이름, 글꼴, 바탕, 테두리, 숫자 서식, 정렬]
  // 글꼴: 0 기본 · 1 머리글(흰 굵게) · 2 굵게 · 3 큰 제목 · 4~7 여론 색 굵게 · 8 회색 작은 글씨
  // 바탕: 0 없음 · 2 현대 블루 · 3 옅은 회색
  const STYLES = [
    ["default", 0, 0, 0, 0, ""],
    ["head", 1, 2, 2, 0, '<alignment horizontal="center" vertical="center" wrapText="1"/>'],
    ["cell", 0, 0, 1, 0, '<alignment vertical="top"/>'],
    ["wrap", 0, 0, 1, 0, '<alignment vertical="top" wrapText="1"/>'],
    ["center", 0, 0, 1, 0, '<alignment horizontal="center" vertical="center"/>'],
    ["pct", 0, 0, 1, 164, '<alignment horizontal="center" vertical="center"/>'],
    ["date", 0, 0, 1, 165, '<alignment horizontal="center" vertical="top"/>'],
    ["tone-긍정", 4, 0, 1, 0, '<alignment horizontal="center" vertical="center"/>'],
    ["tone-중립", 5, 0, 1, 0, '<alignment horizontal="center" vertical="center"/>'],
    ["tone-부정", 6, 0, 1, 0, '<alignment horizontal="center" vertical="center"/>'],
    ["tone-단순비난", 7, 0, 1, 0, '<alignment horizontal="center" vertical="center"/>'],
    ["title", 3, 0, 0, 0, '<alignment vertical="center"/>'],
    ["sub", 2, 3, 1, 0, '<alignment horizontal="center" vertical="center" wrapText="1"/>'],
    ["note", 8, 0, 0, 0, '<alignment vertical="top" wrapText="1"/>'],
    ["bold", 2, 0, 1, 0, '<alignment horizontal="center" vertical="center"/>'],
    ["pct-긍정", 4, 0, 1, 164, '<alignment horizontal="center" vertical="center"/>'],
    ["pct-부정", 6, 0, 1, 164, '<alignment horizontal="center" vertical="center"/>'],
    ["wrap-head", 2, 3, 1, 0, '<alignment vertical="center" wrapText="1"/>'],
  ];
  const STYLE_INDEX = Object.fromEntries(STYLES.map(([n], i) => [n, i]));

  function stylesXml(font) {
    const f = esc(font);
    const fontXml = (extra, sz = 11, color = "") => `<font>${extra}<sz val="${sz}"/>${color ? `<color rgb="${color}"/>` : ""}<name val="${f}"/><charset val="129"/></font>`;
    const fonts = [
      fontXml(""),
      fontXml("<b/>", 11, "FFFFFFFF"),
      fontXml("<b/>"),
      fontXml("<b/>", 15, NAVY),
      fontXml("<b/>", 11, TONE_COLORS["긍정"]),
      fontXml("<b/>", 11, TONE_COLORS["중립"]),
      fontXml("<b/>", 11, TONE_COLORS["부정"]),
      fontXml("<b/>", 11, TONE_COLORS["단순비난"]),
      fontXml("", 10, "FF6B7280"),
    ];
    const fill = (rgb) => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
    // 표 테두리: 옅은 회색 얇은 선 · 항목명(head) 칸: 흰색 얇은 선
    const thinOf = (c) => `<left style="thin"><color rgb="${c}"/></left><right style="thin"><color rgb="${c}"/></right>` +
      `<top style="thin"><color rgb="${c}"/></top><bottom style="thin"><color rgb="${c}"/></bottom><diagonal/>`;
    const xfs = STYLES.map(([, fontId, fillId, borderId, numFmtId, align]) =>
      `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1"` +
      `${numFmtId ? ' applyNumberFormat="1"' : ""}${align ? ` applyAlignment="1">${align}</xf>` : "/>"}`).join("");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="2"><numFmt numFmtId="164" formatCode="0.0%"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/></numFmts>' +
      `<fonts count="${fonts.length}">${fonts.join("")}</fonts>` +
      `<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fill(NAVY)}${fill("FFF2F2F2")}</fills>` +
      `<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border>${thinOf("FFD9D9D9")}</border><border>${thinOf("FFFFFFFF")}</border></borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${STYLES.length}">${xfs}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      "</styleSheet>";
  }

  function sheetXml(sheet) {
    const rows = sheet.rows || [];
    const ncols = Math.max(1, ...rows.map((r) => r.length));
    const widths = sheet.widths || {};
    const heights = sheet.heights || {};
    let cols = "";
    for (let c = 1; c <= ncols; c++) cols += `<col min="${c}" max="${c}" width="${widths[c] || 12}" customWidth="1"/>`;
    let data = "";
    rows.forEach((row, ri) => {
      const r = ri + 1;
      let cells = "";
      (row || []).forEach((cell, ci) => {
        const obj = cell !== null && typeof cell === "object" && !(cell instanceof Date) ? cell : { v: cell };
        const s = STYLE_INDEX[obj.s] || 0;
        const ref = colName(ci + 1) + r;
        const v = obj.v;
        const sAttr = s ? ` s="${s}"` : "";
        if (v === null || v === undefined || v === "") {
          if (s) cells += `<c r="${ref}"${sAttr}/>`;
        } else if (typeof v === "number" && isFinite(v)) {
          cells += `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
        } else {
          cells += `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        }
      });
      const ht = heights[r] ? ` ht="${heights[r]}" customHeight="1"` : "";
      data += `<row r="${r}"${ht}>${cells}</row>`;
    });
    const lastRef = colName(ncols) + Math.max(1, rows.length);
    const pane = sheet.freeze
      ? `<pane ySplit="${sheet.freeze}" topLeftCell="A${sheet.freeze + 1}" activePane="bottomLeft" state="frozen"/>`
      : "";
    const merges = (sheet.merges || []).length
      ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
      : "";
    const filter = sheet.filter && rows.length ? `<autoFilter ref="${sheet.filter}"/>` : "";
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<dimension ref="A1:${lastRef}"/>` +
      `<sheetViews><sheetView workbookViewId="0"${sheet.noGrid ? ' showGridLines="0"' : ""}>${pane}</sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="16.5"/><cols>${cols}</cols><sheetData>${data}</sheetData>${filter}${merges}` +
      "</worksheet>";
  }

  // 필터 범위 "B3:K3" → 머리글 행부터 마지막 행까지
  function filterRange(sheet) {
    if (!sheet.filter) return null;
    const m = sheet.filter.match(/^([A-Z]+)(\d+):([A-Z]+)\d+$/);
    if (!m) return null;
    const last = Math.max(Number(m[2]), (sheet.rows || []).length);
    return { ref: `${m[1]}${m[2]}:${m[3]}${last}`, abs: `$${m[1]}$${m[2]}:$${m[3]}$${last}` };
  }

  function build(sheets, { font = "맑은 고딕" } = {}) {
    sheets = sheets.map((s) => {
      const f = filterRange(s);
      return f ? { ...s, filter: f.ref, filterAbs: f.abs } : s;
    });
    const files = [];
    files.push({
      name: "[Content_Types].xml",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
        "</Types>",
    });
    files.push({
      name: "_rels/.rels",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>",
    });
    const names = sheets
      .map((s, i) => (s.filterAbs ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name)}'!${s.filterAbs}</definedName>` : ""))
      .join("");
    files.push({
      name: "xl/workbook.xml",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
        (names ? `<definedNames>${names}</definedNames>` : "") +
        "</workbook>",
    });
    files.push({
      name: "xl/_rels/workbook.xml.rels",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        "</Relationships>",
    });
    files.push({ name: "xl/styles.xml", data: stylesXml(font) });
    sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) }));
    return zip(files);
  }

  global.XlsxBook = { build, colName, TONE_COLORS };
  if (typeof module !== "undefined") module.exports = global.XlsxBook;
})(typeof window !== "undefined" ? window : globalThis);
