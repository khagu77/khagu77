// 보고서 엑셀(.xlsx) 만들기 - 보내주신 양식(Sheet1, A~F 열)과 같은 모양.
// A 커뮤니티명 | B 차종 | C 게시일(10월 06일) | D 구분 | E URL(링크) | F 주요 내용 (집중 관리 항목은 노란색)
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
      const data = enc.encode(f.data);
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

  // 셀 서식 번호 - 보내주신 양식의 styles.xml(report-template.js) 그대로
  const S = { header: 5, center: 3, date: 4, link: 7, text: 9, textYellow: 8 };
  const tpl = typeof TEMPLATE_STYLES_XML !== "undefined" ? { styles: TEMPLATE_STYLES_XML, theme: TEMPLATE_THEME_XML } : require("./report-template.js");
  const STYLES = tpl.styles || tpl.TEMPLATE_STYLES_XML;
  const THEME = tpl.theme || tpl.TEMPLATE_THEME_XML;

  function excelSerial(date) {
    const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.round((utc - Date.UTC(1899, 11, 30)) / 86400000);
  }

  // rows: [{community, car, date: Date, category, url, summary, highlight}]
  function build(rows) {
    const strCell = (ref, v, s) => (v === "" || v === null || v === undefined ? `<c r="${ref}" s="${s}"/>` : `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`);
    let data =
      '<row r="1" spans="1:7" x14ac:dyDescent="0.4">' +
      strCell("A1", "커뮤니티명", S.header) +
      strCell("B1", "차종", S.header) +
      strCell("C1", "게시일", S.header) +
      strCell("D1", "구분", S.header) +
      strCell("E1", "", S.header) +
      strCell("F1", "주요 내용", S.header) +
      "</row>";
    const links = [];
    rows.forEach((r, i) => {
      const n = i + 2;
      data +=
        `<row r="${n}" spans="1:7" x14ac:dyDescent="0.4">` +
        strCell(`A${n}`, r.community, S.center) +
        strCell(`B${n}`, r.car, S.center) +
        (r.date ? `<c r="C${n}" s="${S.date}"><v>${excelSerial(r.date)}</v></c>` : strCell(`C${n}`, "", S.date)) +
        strCell(`D${n}`, r.category, S.center) +
        strCell(`E${n}`, r.url, S.link) +
        strCell(`F${n}`, r.summary, r.highlight ? S.textYellow : S.text) +
        "</row>";
      if (r.url) links.push({ ref: `E${n}`, url: r.url });
    });
    // 열 너비·열 기본 서식도 양식 그대로 (A~D 가운데, E~F 왼쪽, G 빈 열)
    const cols =
      '<col min="1" max="1" width="18.5" style="2" bestFit="1" customWidth="1"/>' +
      '<col min="2" max="2" width="13.59765625" style="2" bestFit="1" customWidth="1"/>' +
      '<col min="3" max="3" width="9.19921875" style="2" bestFit="1" customWidth="1"/>' +
      '<col min="4" max="4" width="7.3984375" style="2" bestFit="1" customWidth="1"/>' +
      '<col min="5" max="5" width="64.69921875" style="1" bestFit="1" customWidth="1"/>' +
      '<col min="6" max="6" width="80.19921875" style="1" bestFit="1" customWidth="1"/>' +
      '<col min="7" max="7" width="9.8984375" bestFit="1" customWidth="1"/>';
    const lastRow = Math.max(1, rows.length + 1);
    const sheet =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
      ' xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">' +
      '<sheetPr codeName="Sheet1"/>' +
      `<dimension ref="A1:F${lastRow}"/>` +
      '<sheetViews><sheetView tabSelected="1" zoomScale="85" zoomScaleNormal="85" workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="17.399999999999999" x14ac:dyDescent="0.4"/>' +
      `<cols>${cols}</cols><sheetData>${data}</sheetData>` +
      (links.length ? `<hyperlinks>${links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rId${i + 1}"/>`).join("")}</hyperlinks>` : "") +
      '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
      '<pageSetup paperSize="9" orientation="portrait"/>' +
      "</worksheet>";
    const sheetRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      links
        .map(
          (l, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(l.url)}" TargetMode="External"/>`
        )
        .join("") +
      "</Relationships>";

    const files = [
      {
        name: "[Content_Types].xml",
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          "</Types>",
      },
      {
        name: "_rels/.rels",
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          "</Relationships>",
      },
      {
        name: "xl/workbook.xml",
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<workbookPr defaultThemeVersion="166925"/><bookViews><workbookView xWindow="-108" yWindow="-108" windowWidth="23256" windowHeight="13176"/></bookViews>' +
          '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029"/></workbook>',
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' +
          "</Relationships>",
      },
      { name: "xl/styles.xml", data: STYLES },
      { name: "xl/theme/theme1.xml", data: THEME },
      { name: "xl/worksheets/sheet1.xml", data: sheet },
    ];
    if (links.length) files.push({ name: "xl/worksheets/_rels/sheet1.xml.rels", data: sheetRels });
    return zip(files);
  }

  global.ReportXlsx = { build };
  if (typeof module !== "undefined") module.exports = global.ReportXlsx;
})(typeof window !== "undefined" ? window : globalThis);
