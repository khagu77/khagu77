// 일일동향 엑셀 리스트 이어 쓰기 (담당자 요청 2026-11-13)
// 담당자가 쓰던 누적 일일동향 엑셀(시트 1개, A~J: 차종 · 제원 · 불만구분 · 매체 · 동호회명 · 게시일 · 게시글 위치 · 내용 · 중복 · 지역)
// 끝에 그날 최종 PPT 의 게시글을 한 줄씩 덧붙인다. 양식·서식은 파일의 마지막 보통 줄을 그대로 본뜬다.
//  - 불만구분: "품질(주의/경고/심각)" 처럼 쓰고 해당 단계만 색 (주의 초록 00B050 · 경고 파랑 0070C0 · 심각 빨강 FF0000)
//  - 게시글 위치: 하이퍼링크, 이미 파일에 있는 게시글(같은 주소)은 다시 넣지 않음
// 큰 파일이라 XML 을 통째로 해석하지 않고 행·하이퍼링크를 문자열로 덧붙인다 (RAW data 이어 쓰기와 같은 방식)
(function (global) {
  const LEVEL_COLOR = { 주의: "FF00B050", 경고: "FF0070C0", 심각: "FFFF0000" };
  const FONT = '<sz val="11"/>{COLOR}<rFont val="현대하모니 M"/><family val="1"/><charset val="129"/>';
  const esc = (s) =>
    String(s ?? "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const unesc = (s) =>
    String(s || "")
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  const urlKey = (u) =>
    String(u || "")
      .trim()
      .replace(/^http:/i, "https:")
      .replace("://m.cafe.", "://cafe.")
      .replace(/(cafe\.naver\.com\/[^/?#]+\/\d+)[?#].*$/i, "$1")
      .replace(/\/+$/, "")
      .toLowerCase();

  function firstSheet(files) {
    const wb = Zip.text(files.get("xl/workbook.xml"));
    const rels = Zip.text(files.get("xl/_rels/workbook.xml.rels"));
    const m = wb.match(/<sheet\b[^>]*>/);
    const rid = m && (m[0].match(/r:id="([^"]*)"/) || [])[1];
    const rel = rid && rels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*>`));
    let target = rel ? (rel[0].match(/Target="([^"]*)"/) || [])[1] : "worksheets/sheet1.xml";
    target = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    return { path: target, rels: target.replace(/([^/]+)$/, "_rels/$1.rels") };
  }

  // 불만구분 칸 글자 (단계만 색)
  function levelRich(kind, level) {
    const lv = LEVEL_COLOR[level] ? level : "주의";
    const run = (t, color) => `<r><rPr>${FONT.replace("{COLOR}", color ? `<color rgb="${color}"/>` : '<color rgb="FF000000"/>')}</rPr><t xml:space="preserve">${esc(t)}</t></r>`;
    return `<r><t xml:space="preserve">${esc(kind || "품질")}(</t></r>${run("주의", lv === "주의" ? LEVEL_COLOR.주의 : null)}${run("/", null)}${run("경고", lv === "경고" ? LEVEL_COLOR.경고 : null)}${run("/", null)}${run("심각", lv === "심각" ? LEVEL_COLOR.심각 : null)}${run(")", null)}`;
  }

  // 파일 정보: 행 수, 마지막 게시일(엑셀 날짜 번호), 이미 있는 게시글 주소
  async function inspect(bytes) {
    const files = await Zip.read(bytes);
    const sh = firstSheet(files);
    const xml = Zip.text(files.get(sh.path));
    const rows = xml.match(/<row\b/g) || [];
    let lastSerial = 0;
    for (const m of xml.matchAll(/<c r="F\d+"[^>]*><v>(\d+(?:\.\d+)?)<\/v>/g)) lastSerial = Math.max(lastSerial, Math.floor(+m[1]));
    return { rows: Math.max(0, rows.length - 1), lastSerial };
  }

  // 월간 실적 보고용: 모든 행의 차종(A)·불만구분(C)·매체(D)·게시일(F, 엑셀 날짜 번호)·게시글 위치(G)·내용(H)
  async function readRows(bytes) {
    const files = await Zip.read(bytes);
    const sh = firstSheet(files);
    const xml = Zip.text(files.get(sh.path));
    const sst = files.has("xl/sharedStrings.xml") ? Zip.text(files.get("xl/sharedStrings.xml")) : "";
    const texts = (frag) => [...String(frag).matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join("");
    const si = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
    const out = [];
    for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const r = {};
      for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const col = cm[1];
        const attrs = cm[2];
        const body = cm[3] || "";
        const t = (attrs.match(/\bt="([^"]*)"/) || [])[1];
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val;
        if (t === "s") val = si[+v] ?? "";
        else if (t === "inlineStr") val = texts(body);
        else if (t === "str") val = unesc(v || "");
        else val = v != null ? +v : "";
        r[col] = val;
      }
      if (typeof r.F !== "number" || !r.A) continue; // 머리글·빈 줄 제외
      out.push({ code: String(r.A).trim(), kind: String(r.C || "").replace(/\(.*$/, "").trim(), media: String(r.D || "").trim(), serial: Math.floor(r.F), url: String(r.G || ""), content: String(r.H || "") });
    }
    return out;
  }

  // rows: [{ code, spec, kind, level, media, cafe, serial, url, content, duplicate, region }]
  async function append(bytes, rows) {
    const files = await Zip.read(bytes);
    const sh = firstSheet(files);
    let xml = Zip.text(files.get(sh.path));
    let rels = files.has(sh.rels) ? Zip.text(files.get(sh.rels)) : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    const shared = files.has("xl/sharedStrings.xml") ? Zip.text(files.get("xl/sharedStrings.xml")) : "";

    // 이미 있는 게시글 주소 (링크·글자 모두)
    const existing = new Set();
    for (const src of [rels, shared, xml]) for (const m of String(src).matchAll(/https?:\/\/[^"<\s]+/g)) existing.add(urlKey(unesc(m[0])));
    const seen = new Set();
    let skipped = 0;
    const todo = rows.filter((r) => {
      const k = urlKey(r.url);
      if (k && (existing.has(k) || seen.has(k))) {
        skipped++;
        return false;
      }
      if (k) seen.add(k);
      return true;
    });

    const endData = xml.indexOf("</sheetData>");
    if (endData < 0) throw new Error("일일동향 엑셀 시트 형식을 읽지 못했습니다");
    const rowXmls = [...xml.slice(0, endData).matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)];
    const lastRowNo = rowXmls.length ? +rowXmls[rowXmls.length - 1][1] : 1;
    // 본뜰 줄: 최근 줄들 중 A칸 서식이 가장 흔한 줄의 마지막 것 (날짜 구분용으로 테두리만 다른 줄은 피함)
    const recent = rowXmls.slice(-60).filter((m) => +m[1] > 1);
    const styleOf = (rowInner, col) => (rowInner.match(new RegExp(`<c r="${col}\\d+"[^>]*?\\bs="(\\d+)"`)) || [])[1];
    const cnt = new Map();
    for (const m of recent) {
      const s = styleOf(m[2], "A");
      cnt.set(s, (cnt.get(s) || 0) + 1);
    }
    const commonA = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const proto = [...recent].reverse().find((m) => styleOf(m[2], "A") === commonA) || rowXmls[rowXmls.length - 1];
    const protoAttrs = proto ? (proto[0].match(/^<row ([^>]*)>/) || [])[1] || "" : "";
    const st = {};
    for (const col of "ABCDEFGHIJ") {
      const s = proto ? styleOf(proto[2], col) : null;
      st[col] = s != null ? ` s="${s}"` : "";
    }
    // 제원이 숫자처럼 보일 때(2.0 등) 쓰던 서식 (작은따옴표 붙은 글자 서식)
    let numSpecStyle = st.B;
    const sis = shared ? [...shared.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unesc((m[1].match(/<t[^>]*>([^<]*)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join(""))) : [];
    for (const m of [...rowXmls].reverse().slice(0, 400)) {
      const c = m[2].match(/<c r="B\d+"[^>]*?\bs="(\d+)"[^>]*t="s"[^>]*><v>(\d+)<\/v>/);
      if (c && /^\d/.test(sis[+c[2]] || "")) {
        numSpecStyle = ` s="${c[1]}"`;
        break;
      }
    }

    let maxRid = 0;
    for (const x of rels.matchAll(/Id="rId(\d+)"/g)) maxRid = Math.max(maxRid, +x[1]);
    for (const x of xml.matchAll(/r:id="rId(\d+)"/g)) maxRid = Math.max(maxRid, +x[1]);
    const attrsFor = (r) => (protoAttrs ? protoAttrs.replace(/\br="\d+"/, `r="${r}"`) : `r="${r}" spans="1:10"`);
    const str = (ref, s, t) => `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>`;
    let out = "";
    let links = "";
    let newRels = "";
    let r = lastRowNo;
    for (const row of todo) {
      r++;
      const spec = String(row.spec ?? "-") || "-";
      out +=
        `<row ${attrsFor(r)}>` +
        str(`A${r}`, st.A, row.code || "-") +
        str(`B${r}`, /^\d/.test(spec) ? numSpecStyle : st.B, spec) +
        `<c r="C${r}"${st.C} t="inlineStr"><is>${levelRich(row.kind, row.level)}</is></c>` +
        str(`D${r}`, st.D, row.media || "동호회") +
        str(`E${r}`, st.E, row.cafe || "") +
        (row.serial ? `<c r="F${r}"${st.F}><v>${row.serial}</v></c>` : `<c r="F${r}"${st.F}/>`) +
        str(`G${r}`, st.G, row.url || "") +
        str(`H${r}`, st.H, row.content || "") +
        str(`I${r}`, st.I, row.duplicate || "신규") +
        str(`J${r}`, st.J, row.region || "-") +
        "</row>";
      if (/^https?:\/\//i.test(row.url || "")) {
        maxRid++;
        links += `<hyperlink ref="G${r}" r:id="rId${maxRid}"/>`;
        newRels += `<Relationship Id="rId${maxRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(row.url)}" TargetMode="External"/>`;
      }
    }
    xml = xml.slice(0, endData) + out + xml.slice(endData);
    if (links) xml = /<\/hyperlinks>/.test(xml) ? xml.replace("</hyperlinks>", `${links}</hyperlinks>`) : xml.replace(/(<\/sheetData>(?:<sheetCalcPr[^>]*\/>)?(?:<sheetProtection[^>]*\/>)?(?:<protectedRanges>[\s\S]*?<\/protectedRanges>)?(?:<scenarios[\s\S]*?<\/scenarios>)?(?:<autoFilter[\s\S]*?(?:\/>|<\/autoFilter>))?(?:<sortState[\s\S]*?<\/sortState>)?(?:<dataConsolidate[\s\S]*?<\/dataConsolidate>)?(?:<customSheetViews>[\s\S]*?<\/customSheetViews>)?(?:<mergeCells[\s\S]*?<\/mergeCells>)?(?:<phoneticPr[^>]*\/>)?(?:<conditionalFormatting[\s\S]*?<\/conditionalFormatting>)*(?:<dataValidations[\s\S]*?<\/dataValidations>)?)/, `$1<hyperlinks>${links}</hyperlinks>`);
    xml = xml.replace(/<dimension ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\s*\/>/, (all, c1, r1, c2, r2) => `<dimension ref="${c1}${r1}:${c2}${Math.max(+r2, r)}"/>`);
    // 열면 마지막 줄 근처가 보이게
    xml = xml.replace(/(<sheetView\b[^>]*?)\stopLeftCell="[A-Z]+\d+"/, "$1").replace(/<sheetView\b/, `<sheetView topLeftCell="A${Math.max(1, r - 15)}"`);
    xml = xml.replace(/<selection\b[^>]*\/>/, `<selection activeCell="A${r + 1}" sqref="A${r + 1}"/>`);
    files.set(sh.path, Zip.bytes(xml));
    if (newRels) {
      rels = rels.replace("</Relationships>", `${newRels}</Relationships>`);
      files.set(sh.rels, Zip.bytes(rels));
      const ct = Zip.text(files.get("[Content_Types].xml"));
      if (!/Extension="rels"/.test(ct)) files.set("[Content_Types].xml", Zip.bytes(ct.replace("</Types>", '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>')));
    }
    files.delete("xl/calcChain.xml");
    const ct = files.get("[Content_Types].xml");
    if (ct) files.set("[Content_Types].xml", Zip.bytes(Zip.text(ct).replace(/<Override[^>]*calcChain[^>]*\/>/, "")));
    const wbRel = files.get("xl/_rels/workbook.xml.rels");
    if (wbRel) files.set("xl/_rels/workbook.xml.rels", Zip.bytes(Zip.text(wbRel).replace(/<Relationship[^>]*calcChain[^>]*\/>/, "")));
    return { bytes: await Zip.write(files), added: todo.length, skipped, lastRow: r };
  }

  global.DailyTrend = { append, inspect, readRows, urlKey };
})(typeof window !== "undefined" ? window : self);
