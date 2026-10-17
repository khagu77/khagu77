// 차종별 온라인 동향 RAW data 엑셀 이어 쓰기
// 오늘 PPT 작성용 엑셀(일일 부정 이슈 수집)의 모든 행을 지난 RAW data 엑셀 끝에 이어 붙인다.
//  - 시트 2개: '현대자동차'(제네시스 차종 빼고 전부) / '제네시스'(제네시스 차종만). C열 차종으로 나눔
//  - A열 연번은 각 시트의 마지막 연번에서 이어서
//  - B~G: 커뮤니티명 · 차종 · 게시일 · 구분 · 게시글 위치(하이퍼링크) · 주요 내용. '+' 표시는 넣지 않음
//  - 셀 서식은 시트의 마지막 행과 같게, 배경색(노랑·파랑 등)은 없앰
// RAW 파일이 크므로(수만 행) XML 을 통째로 해석하지 않고, 행·하이퍼링크를 문자열로 덧붙인다(나머지는 그대로).
(function (global) {
  // 제네시스 차종 코드 (C열 첫 단어 기준)
  const GENESIS = /^(RG3|RG4|RS4|JX|JK|JW|IK|DH|JG|HI|GV\d*|G70|G80|G90|EQ900)(\b|PE|$)/i;
  const isGenesis = (car) => GENESIS.test(String(car || "").trim().split(/\s+/)[0] || "");

  const escXml = (s) =>
    String(s ?? "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  // 엑셀 날짜 일련번호 (1900 기준)
  const toSerial = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
  const serialText = (n) => {
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
  };
  function dateSerial(v) {
    const t = String(v ?? "").trim();
    if (/^\d+(\.\d+)?$/.test(t) && Number(t) > 20000) return Math.floor(Number(t));
    const m = t.match(/(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})/);
    return m ? toSerial(+m[1], +m[2], +m[3]) : null;
  }

  // 셀 서식에 배경색이 있으면 배경색만 뺀 서식으로 (없으면 새로 만들어 styles.xml 끝에 추가)
  function noFillStyles(stylesXml) {
    const m = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
    if (!m) return { map: (s) => s, finish: null };
    const xfs = m[1].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) || [];
    const added = [];
    const cache = {};
    const map = (s) => {
      if (s == null || s === "") return s;
      if (s in cache) return cache[s];
      const xf = xfs[Number(s)];
      if (!xf || /fillId="0"/.test(xf) || !/fillId="/.test(xf)) return (cache[s] = s);
      const plain = xf.replace(/fillId="\d+"/, 'fillId="0"').replace(/\s*applyFill="1"/, "");
      let k = xfs.indexOf(plain);
      if (k < 0) {
        let a = added.indexOf(plain);
        if (a < 0) {
          added.push(plain);
          a = added.length - 1;
        }
        k = xfs.length + a;
      }
      return (cache[s] = String(k));
    };
    const finish = () => {
      if (!added.length) return stylesXml;
      return stylesXml.replace(/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/, (all, attrs, inner) =>
        `<cellXfs${attrs.replace(/count="\d+"/, `count="${xfs.length + added.length}"`)}>${inner}${added.join("")}</cellXfs>`,
      );
    };
    return { map, finish };
  }

  // 시트 XML 끝에 행 추가 → { xml, rels, from, to, count, lastDate }
  function appendRows(sheetXml, relsXml, rows, styleMap) {
    const endData = sheetXml.indexOf("</sheetData>");
    if (endData < 0) throw new Error("RAW 엑셀 시트 형식을 읽지 못했습니다");
    const lastRowAt = sheetXml.lastIndexOf("<row ", endData);
    const lastRow = lastRowAt >= 0 ? sheetXml.slice(lastRowAt, endData) : "";
    const rowNo = lastRow ? Number((lastRow.match(/^<row [^>]*\br="(\d+)"/) || [])[1] || 1) : 1;
    // 마지막 행의 연번(A열)과 열별 서식·게시일
    const cellOf = (col) => (lastRow.match(new RegExp(`<c r="${col}${rowNo}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`)) || []);
    const styleOf = (col) => ((cellOf(col)[1] || "").match(/\bs="(\d+)"/) || [])[1];
    const valOf = (col) => ((cellOf(col)[2] || "").match(/<v>([^<]*)<\/v>/) || [])[1];
    let seq = Number(valOf("A"));
    if (!Number.isFinite(seq)) seq = rowNo - 1;
    const lastDate = Number(valOf("D")) || null;
    const rowAttrs = (lastRow.match(/^<row ([^>]*)>/) || [])[1] || "";
    const attrsFor = (r) => (rowAttrs ? rowAttrs.replace(/\br="\d+"/, `r="${r}"`) : `r="${r}"`);
    const st = {};
    for (const col of "ABCDEFG") {
      const s = styleMap(styleOf(col));
      st[col] = s != null ? ` s="${s}"` : "";
    }

    // 하이퍼링크 관계 번호: 이 시트에서 쓰는 가장 큰 rId 다음부터
    let maxRid = 0;
    for (const x of relsXml.matchAll(/Id="rId(\d+)"/g)) maxRid = Math.max(maxRid, Number(x[1]));
    for (const x of sheetXml.matchAll(/r:id="rId(\d+)"/g)) maxRid = Math.max(maxRid, Number(x[1]));

    const str = (ref, s, text) => `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escXml(text)}</t></is></c>`;
    let xmlRows = "";
    let links = "";
    let rels = "";
    const from = seq + 1;
    let r = rowNo;
    for (const row of rows) {
      r++;
      seq++;
      const date = row.serial;
      xmlRows +=
        `<row ${attrsFor(r)}>` +
        `<c r="A${r}"${st.A}><v>${seq}</v></c>` +
        str(`B${r}`, st.B, row.cafe) +
        str(`C${r}`, st.C, row.car) +
        (date ? `<c r="D${r}"${st.D}><v>${date}</v></c>` : `<c r="D${r}"${st.D}/>`) +
        str(`E${r}`, st.E, row.kind) +
        str(`F${r}`, st.F, row.url) +
        str(`G${r}`, st.G, row.main) +
        `</row>`;
      if (/^https?:\/\//i.test(row.url)) {
        maxRid++;
        links += `<hyperlink ref="F${r}" r:id="rId${maxRid}"/>`;
        rels += `<Relationship Id="rId${maxRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escXml(row.url)}" TargetMode="External"/>`;
      }
    }
    let xml = sheetXml.slice(0, endData) + xmlRows + sheetXml.slice(endData);
    // 사용 범위(dimension)
    xml = xml.replace(/<dimension ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\s*\/>/, (all, c1, r1, c2, r2) =>
      `<dimension ref="${c1}${r1}:${c2 < "G" ? "G" : c2}${Math.max(Number(r2), r)}"/>`,
    );
    // 커서: 마지막 연번 바로 아래 A열 칸에 두고, 그 칸이 화면에 보이게 (저장해 다시 열면 바로 이어서 입력)
    const cur = `A${r + 1}`;
    xml = xml.replace(/<sheetView\b([^>]*?)(\/?)>/, (all, attrs, selfClose) => {
      const a = attrs.replace(/\s*topLeftCell="[^"]*"/, "") + ` topLeftCell="A${Math.max(1, r - 25)}"`;
      return `<sheetView${a}${selfClose}>`;
    });
    xml = xml.replace(/(<sheetView\b[^>]*?)\/>/, "$1></sheetView>");
    xml = xml.replace(/(<sheetView\b[^>]*>)([\s\S]*?)(<\/sheetView>)/, (all, open, inner, close) => {
      const keep = inner.replace(/<selection\b[^>]*\/>/g, "").replace(/<pane\b[^>]*\/>/g, (p) => p);
      return `${open}${keep}<selection activeCell="${cur}" sqref="${cur}"/>${close}`;
    });
    if (links) {
      if (xml.includes("</hyperlinks>")) xml = xml.replace("</hyperlinks>", `${links}</hyperlinks>`);
      else {
        // 하이퍼링크 목록이 없던 시트: 규격 순서상 printOptions/pageMargins/pageSetup/drawing 앞에
        const before = ["<printOptions", "<pageMargins", "<pageSetup", "<headerFooter", "<drawing", "<legacyDrawing", "<tableParts", "<extLst", "</worksheet>"]
          .map((t) => xml.indexOf(t))
          .filter((i) => i > 0)
          .sort((a, b) => a - b)[0];
        xml = xml.slice(0, before) + `<hyperlinks>${links}</hyperlinks>` + xml.slice(before);
      }
      if (!/xmlns:r=/.test(xml.slice(0, 1000))) {
        xml = xml.replace("<worksheet ", '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
      }
    }
    const newRels = relsXml
      ? relsXml.replace("</Relationships>", `${rels}</Relationships>`)
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
    return { xml, rels: newRels, from, to: seq, count: rows.length, lastDate };
  }

  // 시트 이름 → 파일 경로
  function sheetPaths(files) {
    const wb = Zip.text(files.get("xl/workbook.xml"));
    const wbRels = Zip.text(files.get("xl/_rels/workbook.xml.rels"));
    const out = [];
    for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
      const name = (m[0].match(/name="([^"]*)"/) || [])[1] || "";
      const rid = (m[0].match(/r:id="([^"]*)"/) || [])[1];
      const rel = wbRels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*>`));
      let target = rel ? (rel[0].match(/Target="([^"]*)"/) || [])[1] : "";
      if (!target) continue;
      target = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
      const decoded = name.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
      out.push({ name: decoded, path: target, rels: target.replace(/([^/]+)$/, "_rels/$1.rels") });
    }
    return out;
  }

  // RAW 엑셀에 오늘 행을 이어 붙인다.
  // daily: [{cafe, car, date, kind, url, main}] (Excel.readAllRows), fallbackSerial: 게시일이 빈 행에 쓸 날짜
  // → { bytes, sheets: [{name, count, from, to}], dupDates: [이미 RAW 에 있는 게시일] }
  async function append(rawBytes, daily, { fallbackSerial = null } = {}) {
    const files = await Zip.read(rawBytes);
    const sheets = sheetPaths(files);
    const hy = sheets.find((s) => /현대/.test(s.name));
    const gn = sheets.find((s) => /제네시스|genesis/i.test(s.name));
    if (!hy || !gn) throw new Error("RAW 엑셀에서 '현대자동차'·'제네시스' 시트를 찾지 못했습니다");
    const rows = daily
      .filter((r) => r.url || r.main || r.car)
      .map((r) => ({ ...r, serial: dateSerial(r.date) ?? fallbackSerial }));
    const styles = files.has("xl/styles.xml") ? noFillStyles(Zip.text(files.get("xl/styles.xml"))) : { map: (s) => s, finish: null };
    const result = [];
    const dupDates = new Set();
    for (const [sheet, list] of [
      [hy, rows.filter((r) => !isGenesis(r.car))],
      [gn, rows.filter((r) => isGenesis(r.car))],
    ]) {
      const xml = Zip.text(files.get(sheet.path));
      const rels = files.has(sheet.rels) ? Zip.text(files.get(sheet.rels)) : "";
      const out = appendRows(xml, rels, list, styles.map);
      // 같은 게시일 자료가 이미 들어 있으면 알려 준다 (두 번 받기 방지)
      for (const r of list) if (out.lastDate && r.serial && r.serial <= out.lastDate) dupDates.add(serialText(r.serial));
      files.set(sheet.path, Zip.bytes(out.xml));
      if (list.length) files.set(sheet.rels, Zip.bytes(out.rels));
      result.push({ name: sheet.name, count: out.count, from: out.from, to: out.to });
    }
    if (styles.finish) files.set("xl/styles.xml", Zip.bytes(styles.finish()));
    // 열 때 수식·요약을 다시 계산하게
    files.delete("xl/calcChain.xml");
    const ct = files.get("[Content_Types].xml");
    if (ct) files.set("[Content_Types].xml", Zip.bytes(Zip.text(ct).replace(/<Override[^>]*calcChain[^>]*\/>/, "")));
    const wbRel = files.get("xl/_rels/workbook.xml.rels");
    if (wbRel) files.set("xl/_rels/workbook.xml.rels", Zip.bytes(Zip.text(wbRel).replace(/<Relationship[^>]*calcChain[^>]*\/>/, "")));
    return { bytes: await Zip.write(files), sheets: result, dupDates: [...dupDates] };
  }

  global.Raw = { append, isGenesis, dateSerial, toSerial };
})(typeof window !== "undefined" ? window : self);
