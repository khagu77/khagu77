// 외부 라이브러리 없이 .xlsx 만들기 — 서식(글꼴·채우기·테두리·숫자/날짜 형식) · 칸 합치기 · 하이퍼링크 · 틀 고정 · 필터
// · 셀 위 그림(썸네일 JPEG/PNG) · 꺾은선 차트(엑셀에서 바로 고칠 수 있는 진짜 차트)
//
// XlsxPro.build({ sheets: [{
//   name, cols: [너비…], rows: [{ h: 행높이(pt), cells: [{ v, s: 서식이름 } | 값 | null] }],
//   merges: ["A1:F1"], freeze: { row: 3, col: 0 }, filter: "A3:M120", links: [{ r, c, url }],
//   images: [{ r, c, bytes, type: "jpeg"|"png", w, h, dx, dy }]   // r·c 는 0부터, w·h·dx·dy 는 픽셀
//   charts: [{ from: { r, c }, to: { r, c }, title, cat: { sheet, r1, r2, c }, series: [{ name, r1, r2, c, color, dash, marker, width }], fmt: "m/d" }]
// }] }) → Promise<Uint8Array>
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
  function crc32(b) {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  async function deflate(bytes) {
    if (typeof CompressionStream === "undefined") return null;
    const cs = new CompressionStream("deflate-raw");
    const out = new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
    return new Uint8Array(await out);
  }

  async function zip(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const raw = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      const crc = crc32(raw);
      const packed = f.store ? null : await deflate(raw);
      const data = packed || raw;
      const method = packed ? 8 : 0;
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, method, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, raw.length, true);
      local.setUint16(26, name.length, true);
      parts.push(new Uint8Array(local.buffer), name, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, method, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, raw.length, true);
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
    String(s ?? "")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  function colName(n) {
    let s = "";
    for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }
  const ref = (r, c) => `${colName(c)}${r + 1}`;
  const absRef = (sheet, r1, c, r2) => `'${sheet.replace(/'/g, "''")}'!$${colName(c)}$${r1 + 1}:$${colName(c)}$${r2 + 1}`;

  // 날짜 → 엑셀 날짜 값 (이 PC 시간 그대로)
  function serial(d) {
    return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - Date.UTC(1899, 11, 30)) / 86400000;
  }

  // ---- 서식 ----
  const FONT = "맑은 고딕";
  const fonts = [
    `<font><sz val="10"/><color rgb="FF1B1D21"/><name val="${FONT}"/><family val="2"/></font>`, // 0 기본
    `<font><b/><sz val="10"/><color rgb="FF1B1D21"/><name val="${FONT}"/><family val="2"/></font>`, // 1 굵게
    `<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="${FONT}"/><family val="2"/></font>`, // 2 흰 굵게
    `<font><b/><sz val="15"/><color rgb="FF002C5F"/><name val="${FONT}"/><family val="2"/></font>`, // 3 제목
    `<font><u/><sz val="9"/><color rgb="FF1A5FD0"/><name val="${FONT}"/><family val="2"/></font>`, // 4 링크
    `<font><sz val="9"/><color rgb="FF6B7280"/><name val="${FONT}"/><family val="2"/></font>`, // 5 회색 작게
    `<font><b/><sz val="10"/><color rgb="FFD93025"/><name val="${FONT}"/><family val="2"/></font>`, // 6 빨강 굵게
    `<font><b/><sz val="10"/><color rgb="FF1A5FD0"/><name val="${FONT}"/><family val="2"/></font>`, // 7 파랑 굵게
    `<font><sz val="9"/><color rgb="FF1B1D21"/><name val="${FONT}"/><family val="2"/></font>`, // 8 작게
    `<font><b/><sz val="12"/><color rgb="FF1B1D21"/><name val="${FONT}"/><family val="2"/></font>`, // 9 큰 굵게
  ];
  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FF002C5F"/><bgColor indexed="64"/></patternFill></fill>', // 2 남색
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF3F5F8"/><bgColor indexed="64"/></patternFill></fill>', // 3 연회색
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFDECEA"/><bgColor indexed="64"/></patternFill></fill>', // 4 연빨강
  ];
  const borders = [
    "<border><left/><right/><top/><bottom/><diagonal/></border>",
    '<border><left style="thin"><color rgb="FFD9DDE3"/></left><right style="thin"><color rgb="FFD9DDE3"/></right><top style="thin"><color rgb="FFD9DDE3"/></top><bottom style="thin"><color rgb="FFD9DDE3"/></bottom><diagonal/></border>',
  ];
  const numFmts = { 164: "#,##0", 165: "yyyy-mm-dd hh:mm", 166: "yyyy-mm-dd", 167: 'm"/"d"("aaa")"', 168: '[Red]"▲"#,##0;[Blue]"▼"#,##0;"-"' };
  // 이름 → [numFmt, font, fill, border, 가로, 세로, 줄바꿈]
  const STYLE_DEFS = {
    _: [0, 0, 0, 0, null, null, false],
    title: [0, 3, 0, 0, "left", "center", false],
    sub: [0, 5, 0, 0, "left", "center", false],
    head: [0, 2, 2, 1, "center", "center", true],
    text: [0, 0, 0, 1, "left", "center", false],
    textC: [0, 0, 0, 1, "center", "center", false],
    wrap: [0, 0, 0, 1, "left", "center", true],
    small: [0, 8, 0, 1, "left", "center", true],
    bold: [0, 1, 0, 1, "left", "center", true],
    num: [164, 0, 0, 1, "right", "center", false],
    numB: [164, 1, 0, 1, "right", "center", false],
    date: [166, 0, 0, 1, "center", "center", false],
    datetime: [165, 0, 0, 1, "center", "center", false],
    day: [167, 0, 0, 1, "center", "center", false],
    link: [0, 4, 0, 1, "left", "center", true],
    thumb: [0, 0, 0, 1, "center", "center", false],
    neg: [0, 6, 4, 1, "center", "center", false],
    gray: [0, 5, 0, 1, "center", "center", false],
    diff: [168, 1, 0, 1, "center", "center", false],
    kpiLabel: [0, 5, 3, 1, "center", "center", true],
    kpi: [164, 9, 3, 1, "center", "center", false],
    totalL: [0, 1, 3, 1, "center", "center", false],
    totalN: [164, 1, 3, 1, "right", "center", false],
  };
  const STYLE_IDX = {};
  const xfs = Object.entries(STYLE_DEFS).map(([name, [nf, f, fl, b, h, v, w]], i) => {
    STYLE_IDX[name] = i;
    const al = h || v || w ? `<alignment${h ? ` horizontal="${h}"` : ""}${v ? ` vertical="${v}"` : ""}${w ? ' wrapText="1"' : ""}/>` : "";
    return `<xf numFmtId="${nf}" fontId="${f}" fillId="${fl}" borderId="${b}" xfId="0"${nf ? ' applyNumberFormat="1"' : ""} applyFont="1" applyFill="1" applyBorder="1"${al ? ' applyAlignment="1">' + al + "</xf>" : "/>"}`;
  });
  const STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<numFmts count="${Object.keys(numFmts).length}">${Object.entries(numFmts).map(([id, c]) => `<numFmt numFmtId="${id}" formatCode="${esc(c)}"/>`).join("")}</numFmts>` +
    `<fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills><borders count="${borders.length}">${borders.join("")}</borders>` +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  function cellXml(r, c, cell) {
    if (cell == null) return "";
    const o = typeof cell === "object" && !(cell instanceof Date) ? cell : { v: cell };
    const s = STYLE_IDX[o.s || "_"] ?? 0;
    const at = `r="${ref(r, c)}" s="${s}"`;
    let v = o.v;
    if (v == null || v === "") return s ? `<c ${at}/>` : "";
    if (v instanceof Date) v = serial(v);
    if (typeof v === "number" && isFinite(v)) return `<c ${at}><v>${v}</v></c>`;
    if (typeof v === "boolean") return `<c ${at} t="b"><v>${v ? 1 : 0}</v></c>`;
    return `<c ${at} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }

  const PX_EMU = 9525;
  function anchorFrom(r, c, dx = 0, dy = 0) {
    return `<xdr:from><xdr:col>${c}</xdr:col><xdr:colOff>${Math.round(dx * PX_EMU)}</xdr:colOff><xdr:row>${r}</xdr:row><xdr:rowOff>${Math.round(dy * PX_EMU)}</xdr:rowOff></xdr:from>`;
  }

  function chartXml(ch, sheetName) {
    const cache = (vals, fmt) =>
      `<c:numCache><c:formatCode>${esc(fmt || "General")}</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => (v == null ? "" : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join("")}</c:numCache>`;
    const cat = ch.cat;
    const sers = ch.series
      .map(
        (s, i) =>
          `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${esc(s.name)}</c:v></c:tx>` +
          `<c:spPr><a:ln w="${Math.round((s.width || 2) * 12700)}" cap="rnd"><a:solidFill><a:srgbClr val="${s.color.replace("#", "")}"/></a:solidFill>${s.dash ? '<a:prstDash val="dash"/>' : ""}<a:round/></a:ln></c:spPr>` +
          (s.marker
            ? `<c:marker><c:symbol val="circle"/><c:size val="4"/><c:spPr><a:solidFill><a:srgbClr val="${s.color.replace("#", "")}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:marker>`
            : '<c:marker><c:symbol val="none"/></c:marker>') +
          `<c:cat><c:numRef><c:f>${esc(absRef(cat.sheet || sheetName, cat.r1, cat.c, cat.r2))}</c:f>${cache(cat.values || [], ch.fmt || "m/d")}</c:numRef></c:cat>` +
          `<c:val><c:numRef><c:f>${esc(absRef(s.sheet || sheetName, s.r1, s.c, s.r2))}</c:f>${cache(s.values || [], "General")}</c:numRef></c:val><c:smooth val="0"/></c:ser>`,
      )
      .join("");
    const txPr = (sz, color = "595959") =>
      `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/></a:defRPr></a:pPr><a:endParaRPr lang="ko-KR"/></a:p></c:txPr>`;
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<c:roundedCorners val="0"/><c:chart>' +
      (ch.title
        ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="ko-KR" sz="1200" b="1"><a:solidFill><a:srgbClr val="1B1D21"/></a:solidFill><a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/></a:rPr><a:t>${esc(ch.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
        : '<c:autoTitleDeleted val="1"/>') +
      `<c:plotArea><c:layout/><c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${sers}<c:marker val="1"/><c:axId val="5001"/><c:axId val="5002"/></c:lineChart>` +
      `<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="${esc(ch.fmt || "m/d")}" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="BFC5CD"/></a:solidFill></a:ln></c:spPr>${txPr(800)}<c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="0"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:tickLblSkip val="${ch.skip || 7}"/><c:tickMarkSkip val="${ch.skip || 7}"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
      `<c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E3E6EB"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="#,##0" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txPr(800)}<c:crossAx val="5001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>` +
      '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>' +
      `<c:legend><c:legendPos val="t"/><c:overlay val="0"/>${txPr(900, "1B1D21")}</c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
      '<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="D9DDE3"/></a:solidFill></a:ln></c:spPr></c:chartSpace>'
    );
  }

  async function build({ sheets }) {
    const files = [];
    const ct = [];
    let imgN = 0;
    let chartN = 0;
    let drawN = 0;
    const sheetFiles = [];
    sheets.forEach((s, si) => {
      const n = si + 1;
      const rels = [];
      const rid = () => `rId${rels.length + 1}`;
      // 행
      const rowsXml = (s.rows || [])
        .map((row, r) => {
          const o = Array.isArray(row) ? { cells: row } : row;
          const cells = (o.cells || []).map((cell, c) => cellXml(r, c, cell)).join("");
          const ht = o.h ? ` ht="${o.h}" customHeight="1"` : "";
          return cells || ht ? `<row r="${r + 1}"${ht}>${cells}</row>` : "";
        })
        .join("");
      const cols = (s.cols || []).length
        ? `<cols>${s.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
        : "";
      const fr = s.freeze;
      const pane = fr
        ? `<pane${fr.col ? ` xSplit="${fr.col}"` : ""}${fr.row ? ` ySplit="${fr.row}"` : ""} topLeftCell="${ref(fr.row || 0, fr.col || 0)}" activePane="${fr.row && fr.col ? "bottomRight" : fr.row ? "bottomLeft" : "topRight"}" state="frozen"/>`
        : "";
      const merges = (s.merges || []).length ? `<mergeCells count="${s.merges.length}">${s.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
      const links = (s.links || [])
        .filter((l) => /^https?:\/\//.test(l.url || ""))
        .map((l) => {
          const id = rid();
          rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(l.url)}" TargetMode="External"/>`);
          return `<hyperlink ref="${ref(l.r, l.c)}" r:id="${id}"/>`;
        })
        .join("");
      // 그림·차트
      let drawing = "";
      const imgs = s.images || [];
      const charts = s.charts || [];
      if (imgs.length || charts.length) {
        const dn = ++drawN;
        const drels = [];
        const anchors = [];
        let shapeId = 1;
        for (const im of imgs) {
          const ext = im.type === "png" ? "png" : "jpeg";
          const name = `image${++imgN}.${ext}`;
          files.push({ name: `xl/media/${name}`, data: im.bytes, store: true });
          const id = `rId${drels.length + 1}`;
          drels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${name}"/>`);
          const cx = Math.round(im.w * PX_EMU);
          const cy = Math.round(im.h * PX_EMU);
          shapeId++;
          anchors.push(
            `<xdr:oneCellAnchor>${anchorFrom(im.r, im.c, im.dx, im.dy)}<xdr:ext cx="${cx}" cy="${cy}"/>` +
              `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${shapeId}" name="썸네일 ${shapeId}"${im.descr ? ` descr="${esc(im.descr)}"` : ""}/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
              `<xdr:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
              `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`,
          );
        }
        for (const ch of charts) {
          const cn = ++chartN;
          files.push({ name: `xl/charts/chart${cn}.xml`, data: chartXml(ch, s.name) });
          ct.push(`<Override PartName="/xl/charts/chart${cn}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
          const id = `rId${drels.length + 1}`;
          drels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${cn}.xml"/>`);
          shapeId++;
          anchors.push(
            `<xdr:twoCellAnchor editAs="oneCell">${anchorFrom(ch.from.r, ch.from.c)}<xdr:to><xdr:col>${ch.to.c}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${ch.to.r}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
              `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${shapeId}" name="차트 ${cn}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
              `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${id}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`,
          );
        }
        files.push({
          name: `xl/drawings/drawing${dn}.xml`,
          data:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
            anchors.join("") +
            "</xdr:wsDr>",
        });
        files.push({
          name: `xl/drawings/_rels/drawing${dn}.xml.rels`,
          data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drels.join("")}</Relationships>`,
        });
        ct.push(`<Override PartName="/xl/drawings/drawing${dn}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
        const id = rid();
        rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${dn}.xml"/>`);
        drawing = `<drawing r:id="${id}"/>`;
      }
      const sheetXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheetPr>${s.tab ? `<tabColor rgb="FF${s.tab.replace("#", "")}"/>` : ""}<pageSetUpPr fitToPage="1"/></sheetPr>` +
        `<sheetViews><sheetView workbookViewId="0"${si === 0 ? ' tabSelected="1"' : ""}${s.zoom ? ` zoomScale="${s.zoom}"` : ""} showGridLines="${s.grid === false ? 0 : 1}">${pane}</sheetView></sheetViews>` +
        '<sheetFormatPr defaultRowHeight="16.5"/>' +
        cols +
        `<sheetData>${rowsXml}</sheetData>` +
        (s.filter ? `<autoFilter ref="${s.filter}"/>` : "") +
        merges +
        (links ? `<hyperlinks>${links}</hyperlinks>` : "") +
        '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
        `<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>` +
        drawing +
        "</worksheet>";
      files.push({ name: `xl/worksheets/sheet${n}.xml`, data: sheetXml });
      if (rels.length)
        files.push({
          name: `xl/worksheets/_rels/sheet${n}.xml.rels`,
          data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`,
        });
      sheetFiles.push(n);
    });

    const defined = sheets
      .map((s, i) => {
        if (!s.filter) return "";
        const [a, b] = s.filter.split(":");
        const abs = (x) => x.replace(/^([A-Z]+)(\d+)$/, "$$$1$$$2");
        return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name.replace(/'/g, "''"))}'!${abs(a)}:${abs(b)}</definedName>`;
      })
      .join("");
    files.unshift(
      {
        name: "[Content_Types].xml",
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
          '<Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          sheetFiles.map((n) => `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
          ct.join("") +
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
          `<bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
          (defined ? `<definedNames>${defined}</definedNames>` : "") +
          "</workbook>",
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
          `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      },
      { name: "xl/styles.xml", data: STYLES },
    );
    return zip(files);
  }

  global.XlsxPro = { build, serial, colName };
  if (typeof module !== "undefined") module.exports = global.XlsxPro;
})(typeof window !== "undefined" ? window : globalThis);
