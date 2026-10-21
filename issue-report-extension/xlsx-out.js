// 엑셀 받기: 담당자가 준 샘플 엑셀을 양식(templates/*.xlsx)으로 그대로 써서 서체·테두리·열 너비·조건부 서식을 맞추고,
// 채널마다 시트를 하나씩 만든다. (양식의 머리글 행은 그대로, 자료 행은 양식의 '본보기 행' 서식을 따라 쓴다)

const SHEET_ORDER = ["언론", "동호회", "유튜브", "커뮤니티"];

async function loadTemplate(path) {
  const res = await fetch(chrome.runtime.getURL(path));
  return Zip.read(new Uint8Array(await res.arrayBuffer()));
}

function colLetter(n) {
  let s = "";
  for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// 양식 시트 → { head(앞부분), rows[{attrs, styles{A: s}, xml}], tail(뒷부분) }
function splitSheet(xml) {
  const i = xml.indexOf("<sheetData>");
  const j = xml.indexOf("</sheetData>");
  const rows = [...xml.slice(i + 11, j).matchAll(/<row ([^>]*?)(?:\/>|>(.*?)<\/row>)/gs)].map((m) => {
    const styles = {};
    for (const c of (m[2] || "").matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>)/g)) {
      const s = c[2].match(/ s="(\d+)"/);
      styles[c[1]] = s ? s[1] : null;
    }
    return { attrs: m[1].replace(/r="\d+"\s*/, "").trim(), styles, xml: m[0] };
  });
  return { head: xml.slice(0, i), rows, tail: xml.slice(j + 12) };
}

function cellXml(ref, style, value) {
  const s = style != null ? ` s="${style}"` : "";
  if (value === null || value === undefined || value === "") return `<c r="${ref}"${s}/>`;
  if (typeof value === "number" && isFinite(value)) return `<c r="${ref}"${s}><v>${value}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function rowXml(n, attrs, cells) {
  return `<row r="${n}"${attrs ? ` ${attrs}` : ""}>${cells.join("")}</row>`;
}

function safeSheetName(name, used) {
  let base = String(name || "시트").replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "시트";
  let n = base;
  for (let i = 2; used.has(n); i++) n = `${base.slice(0, 28)}(${i})`;
  used.add(n);
  return n;
}

// 시트 XML 들로 통합 문서 만들기 (양식의 서식·테마는 그대로)
async function assembleWorkbook(files, sheets) {
  const out = new Map(files);
  for (const k of [...out.keys()]) if (/^xl\/worksheets\//.test(k)) out.delete(k);
  const used = new Set();
  const names = sheets.map((s) => safeSheetName(s.name, used));
  sheets.forEach((s, i) => {
    out.set(`xl/worksheets/sheet${i + 1}.xml`, s.xml);
    if (s.links.length) {
      out.set(
        `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${s.links
          .map((l, k) => `<Relationship Id="rIdL${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(l.url)}" TargetMode="External"/>`)
          .join("")}</Relationships>`,
      );
    }
  });
  // workbook.xml
  let wb = Zip.text(out.get("xl/workbook.xml"));
  const sheetTags = names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rIdS${i + 1}"/>`).join("");
  const defined = sheets
    .map((s, i) => (s.filter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${names[i].replace(/'/g, "''")}'!${s.filter}</definedName>` : ""))
    .join("");
  wb = wb.replace(/<sheets>.*?<\/sheets>/s, `<sheets>${sheetTags}</sheets>${defined ? `<definedNames>${defined}</definedNames>` : ""}`);
  wb = wb.replace(/activeTab="\d+"/, 'activeTab="0"').replace(/firstSheet="\d+"/, 'firstSheet="0"');
  out.set("xl/workbook.xml", wb);
  // workbook.xml.rels: 시트 관계만 새로
  let rels = Zip.text(out.get("xl/_rels/workbook.xml.rels")).replace(/<Relationship [^>]*\/worksheet"[^>]*\/>/g, "");
  rels = rels.replace(
    "</Relationships>",
    `${names.map((_, i) => `<Relationship Id="rIdS${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
  );
  out.set("xl/_rels/workbook.xml.rels", rels);
  // [Content_Types].xml
  let ct = Zip.text(out.get("[Content_Types].xml")).replace(/<Override PartName="\/xl\/worksheets\/[^"]*"[^>]*\/>/g, "");
  ct = ct.replace(
    "</Types>",
    `${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
  );
  out.set("[Content_Types].xml", ct);
  // docProps/app.xml 의 시트 이름 목록
  if (out.has("docProps/app.xml")) {
    let app = Zip.text(out.get("docProps/app.xml"));
    app = app
      .replace(/<HeadingPairs>.*?<\/HeadingPairs>/s, `<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>워크시트</vt:lpstr></vt:variant><vt:variant><vt:i4>${names.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>`)
      .replace(/<TitlesOfParts>.*?<\/TitlesOfParts>/s, `<TitlesOfParts><vt:vector size="${names.length}" baseType="lpstr">${names.map((n) => `<vt:lpstr>${escapeXml(n)}</vt:lpstr>`).join("")}</vt:vector></TitlesOfParts>`);
    out.set("docProps/app.xml", app);
  }
  return Zip.write(out);
}

// 시트 하나 마무리: 머리·자료 행 + 하이퍼링크 + 첫 시트만 선택 표시
function finishSheet(tpl, rowsXml, links, lastRow, lastCol, index, extra = (x) => x) {
  let head = tpl.head.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${lastCol}${Math.max(lastRow, 1)}"/>`);
  head = head.replace(/ tabSelected="1"/, index === 0 ? ' tabSelected="1"' : "");
  let tail = tpl.tail;
  if (links.length) {
    const hl = `<hyperlinks>${links.map((l, k) => `<hyperlink ref="${l.ref}" r:id="rIdL${k + 1}"/>`).join("")}</hyperlinks>`;
    tail = tail.includes("<pageMargins") ? tail.replace("<pageMargins", `${hl}<pageMargins`) : tail.replace("</worksheet>", `${hl}</worksheet>`);
  }
  return extra(`${head}<sheetData>${rowsXml.join("")}</sheetData>${tail}`);
}

// 게시글 목록 엑셀: 시트마다 No / 출처 / 제목 / 작성시간 / Link (샘플: 20260806_CN8_가격 공개_동호회 게시물)
// sheets: [{ name, rows: [{ source, title, date, url }] }]
// withSentiment: 오른쪽에 '성향'(게시글 자체 성향) 열을 더한다 (머리글·칸 서식은 양식의 출처 열과 같게)
async function buildPostsXlsx(sheets, withSentiment = false) {
  const files = await loadTemplate("templates/posts-template.xlsx");
  const tpl = splitSheet(Zip.text(files.get("xl/worksheets/sheet1.xml")));
  const header = tpl.rows[0];
  const pattern = tpl.rows[1];
  const built = sheets.map((sh, index) => {
    let head = header.xml.replace(/<row r="\d+"/, '<row r="1"');
    if (withSentiment) head = head.replace("</row>", `${cellXml("F1", header.styles.A, "성향")}</row>`).replace(/spans="1:5"/, 'spans="1:6"');
    const rows = [head];
    const links = [];
    sh.rows.forEach((p, i) => {
      const n = i + 2;
      const st = pattern.styles;
      rows.push(
        rowXml(n, pattern.attrs, [
          cellXml(`A${n}`, st.A, i + 1),
          cellXml(`B${n}`, st.B, p.source || ""),
          cellXml(`C${n}`, st.C, p.title || ""),
          cellXml(`D${n}`, st.D, p.date ? excelSerial(p.date) : ""),
          cellXml(`E${n}`, st.E, p.url || ""),
          ...(withSentiment ? [cellXml(`F${n}`, st.A, p.sentiment || "")] : []),
        ]),
      );
      if (p.url) links.push({ ref: `E${n}`, url: p.url });
    });
    return { name: sh.name, links, filter: null, xml: finishSheet(tpl, rows, links, sh.rows.length + 1, withSentiment ? "F" : "E", index) };
  });
  return assembleWorkbook(files, built);
}

// 댓글 엑셀 (성향 분석 전: 성향 칸 비움 / 성향 분석 후: 긍정·중립·부정·단순비난)
// 샘플(CN8 가격 공개 동호회 댓글 성향 분석) 양식: 1행 제목, 2행 domain / text / 성향 + 참고용 작성일 / 게시글 URL
// sheets: [{ name, title, rows: [{ domain, text, sentiment, writtenAt, url }] }]
async function buildCommentsXlsx(sheets) {
  const files = await loadTemplate("templates/comments-template.xlsx");
  const tpl = splitSheet(Zip.text(files.get("xl/worksheets/sheet1.xml")));
  const [titleRow, headRow, firstRow, midRow, lastRow] = tpl.rows;
  const built = sheets.map((sh, index) => {
    const rows = [];
    rows.push(titleRow.xml.replace(/<row r="\d+"/, '<row r="1"').replace(/(<c r="A1"[^>]*><is><t[^>]*>).*?(<\/t>)/s, `$1${escapeXml(sh.title)}$2`));
    const hs = headRow.styles;
    rows.push(rowXml(2, headRow.attrs, [cellXml("A2", hs.A, "domain"), cellXml("B2", hs.B, "text"), cellXml("C2", hs.C, "성향"), cellXml("D2", hs.B, "작성일"), cellXml("E2", hs.B, "게시글 URL")]));
    const links = [];
    const total = sh.rows.length;
    sh.rows.forEach((c, i) => {
      const n = i + 3;
      const pat = i === 0 ? firstRow : i === total - 1 ? lastRow : midRow;
      const st = pat.styles;
      rows.push(
        rowXml(n, pat.attrs, [
          cellXml(`A${n}`, st.A, c.domain || ""),
          cellXml(`B${n}`, st.B, c.text || ""),
          cellXml(`C${n}`, st.C, c.sentiment || ""),
          cellXml(`D${n}`, st.B, c.writtenAt || ""),
          cellXml(`E${n}`, st.B, c.url || ""),
        ]),
      );
      if (c.domain) links.push({ ref: `A${n}`, url: `https://${c.domain}/` });
      if (c.url) links.push({ ref: `E${n}`, url: c.url });
    });
    const last = total + 2;
    const filter = `$A$2:$E$${last}`;
    const xml = finishSheet(tpl, rows, links, last, "E", index, (x) =>
      x
        .replace(/<autoFilter ref="[^"]*"/, `<autoFilter ref="A2:E${last}"`)
        .replace(/<col min="4" max="5"[^>]*\/>/, '<col min="4" max="4" width="17" style="1" customWidth="1"/><col min="5" max="5" width="44" style="1" customWidth="1"/>'),
    );
    return { name: sh.name, links, filter, xml };
  });
  return assembleWorkbook(files, built);
}
