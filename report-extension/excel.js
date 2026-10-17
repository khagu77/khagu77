// 일일 부정 이슈 수집 엑셀(.xlsx/.xltx)에서 '+' 표시된 게시물만 골라낸다.
// - 모든 시트를 읽는다 (차종별로 시트가 나뉜 파일도 됨)
// - 머리글 이름에 'URL·링크·주소' 등이 들어간 열을 URL 열로 본다. 머리글이 없으면 http 주소가 든 열을 찾는다.
// - 칸 글자 대신 하이퍼링크로만 걸린 주소도 읽는다.
(function (global) {
  const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const PKG_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

  // 머리글에 이 말이 들어 있으면 그 열로 본다 (앞에 있는 것부터)
  const HEADERS = {
    url: [/url/i, /링크/, /주소/, /게시글\s*위치/, /link/i],
    cafe: [/커뮤니티/, /카페/, /매체/, /동호회/, /채널/],
    car: [/차종/, /모델/],
    date: [/게시일/, /작성일/, /날짜/, /일자/],
    kind: [/구분/, /유형/],
    title: [/제목/],
    main: [/주요\s*내용/, /내용/, /요약/],
  };
  const PLUS = /^[+＋]$/;
  const HTTP = /^https?:\/\//i;

  const parseXml = (u8) => new DOMParser().parseFromString(Zip.text(u8), "application/xml");
  const els = (doc, name) => [...doc.getElementsByTagNameNS(NS, name)];

  function colIndex(ref) {
    const letters = ref.replace(/\d+/g, "");
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  function cellText(c, shared) {
    const t = c.getAttribute("t");
    if (t === "inlineStr") return [...c.getElementsByTagNameNS(NS, "t")].map((x) => x.textContent).join("");
    const v = c.getElementsByTagNameNS(NS, "v")[0];
    if (!v) return "";
    if (t === "s") return shared[Number(v.textContent)] ?? "";
    if (t === "b") return v.textContent === "1" ? "TRUE" : "FALSE";
    return v.textContent;
  }

  // 엑셀 날짜 일련번호 → "2026-10-06"
  function serialToDate(s) {
    const n = Number(s);
    if (!Number.isFinite(n) || n < 20000) return String(s || "");
    return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
  }

  function relTargets(files, relsPath, basePath) {
    const map = {};
    if (!files.has(relsPath)) return map;
    for (const r of parseXml(files.get(relsPath)).getElementsByTagNameNS(PKG_NS, "Relationship")) {
      const target = r.getAttribute("Target");
      if (r.getAttribute("TargetMode") === "External") map[r.getAttribute("Id")] = target;
      else map[r.getAttribute("Id")] = target.startsWith("/") ? target.slice(1) : `${basePath}/${target}`;
    }
    return map;
  }

  // → [{ name, rows: [[{text, link}]] }]
  async function readSheets(bytes) {
    const files = await Zip.read(bytes);
    const shared = [];
    if (files.has("xl/sharedStrings.xml")) {
      for (const si of els(parseXml(files.get("xl/sharedStrings.xml")), "si")) {
        shared.push([...si.getElementsByTagNameNS(NS, "t")].map((x) => x.textContent).join(""));
      }
    }
    const wb = parseXml(files.get("xl/workbook.xml"));
    const wbRels = relTargets(files, "xl/_rels/workbook.xml.rels", "xl");
    const sheets = [];
    for (const sh of els(wb, "sheet")) {
      if (sh.getAttribute("state") === "hidden" || sh.getAttribute("state") === "veryHidden") continue;
      const path = wbRels[sh.getAttributeNS(REL_NS, "id")];
      if (!path || !files.has(path)) continue;
      const doc = parseXml(files.get(path));
      // 하이퍼링크: 칸 위치 → 주소
      const links = {};
      const sheetRels = relTargets(files, path.replace(/([^/]+)$/, "_rels/$1.rels"), path.replace(/\/[^/]+$/, ""));
      for (const h of els(doc, "hyperlink")) {
        const target = sheetRels[h.getAttributeNS(REL_NS, "id")];
        if (target && HTTP.test(target)) links[h.getAttribute("ref").split(":")[0]] = target;
      }
      const rows = [];
      for (const row of els(doc, "row")) {
        const arr = [];
        for (const c of row.getElementsByTagNameNS(NS, "c")) {
          const ref = c.getAttribute("r");
          arr[colIndex(ref)] = { text: String(cellText(c, shared) ?? "").trim(), link: links[ref] || "" };
        }
        rows.push(Array.from(arr, (x) => x || { text: "", link: "" }));
      }
      sheets.push({ name: sh.getAttribute("name"), rows });
    }
    return sheets;
  }

  // http 주소(글자 또는 하이퍼링크)가 가장 많은 열
  function urlColumnByContent(rows) {
    const count = {};
    rows.forEach((r) => r.forEach((c, j) => {
      if (HTTP.test(c.text) || c.link) count[j] = (count[j] || 0) + 1;
    }));
    const best = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    return best == null ? -1 : Number(best);
  }

  function findColumns(rows) {
    // 머리글 행: 앞 20줄 중 알려진 머리글 이름이 가장 많이 들어 있는 행 (URL 머리글 칸이 비어 있어도 찾음)
    let headerAt = -1;
    let bestScore = 0;
    for (let i = 0; i < Math.min(20, rows.length); i++) {
      const head = rows[i].map((c) => c.text);
      const score = Object.values(HEADERS).filter((pats) =>
        head.some((h) => h && h.length <= 20 && !HTTP.test(h) && pats.some((re) => re.test(h))),
      ).length;
      if (score > bestScore) {
        bestScore = score;
        headerAt = i;
      }
    }
    if (bestScore < 2) headerAt = -1;
    const col = { url: -1, cafe: -1, car: -1, date: -1, kind: -1, title: -1, main: -1 };
    if (headerAt >= 0) {
      const head = rows[headerAt].map((c) => c.text);
      for (const [key, pats] of Object.entries(HEADERS)) {
        for (const re of pats) {
          const k = head.findIndex((h, j) => h && h.length <= 20 && re.test(h) && !Object.values(col).includes(j));
          if (k >= 0) {
            col[key] = k;
            break;
          }
        }
      }
    }
    // URL 열: 머리글이 없거나 비어 있으면 주소가 든 열로
    const body = rows.slice(headerAt + 1);
    const looksUrl = (j) => j >= 0 && body.some((r) => r[j] && (HTTP.test(r[j].text) || r[j].link));
    if (!looksUrl(col.url)) col.url = urlColumnByContent(body);
    if (col.url < 0) return null;
    for (const k of Object.keys(col)) if (k !== "url" && col[k] === col.url) col[k] = -1;
    // 담당자 엑셀 기본 양식: A열 동호회명, B열 차종 (머리글로 못 찾으면 이 자리로)
    if (col.cafe < 0 && col.url !== 0 && col.car !== 0) col.cafe = 0;
    if (col.car < 0 && col.url !== 1 && col.cafe !== 1) col.car = 1;
    return { headerAt, col };
  }

  // → { items: [{cafe, car, date, kind, url, main, row, sheet}], total, sheets: [이름] }
  async function readMarked(bytes) {
    const sheets = await readSheets(bytes);
    const items = [];
    let total = 0;
    const used = [];
    for (const sheet of sheets) {
      const found = findColumns(sheet.rows);
      if (!found) continue;
      const { headerAt, col } = found;
      const get = (r, k) => (col[k] >= 0 && r[col[k]] ? r[col[k]].text.replace(/\s+/g, " ").trim() : "");
      let marked = 0;
      sheet.rows.slice(headerAt + 1).forEach((r, i) => {
        const cell = r[col.url];
        if (!cell) return;
        const url = HTTP.test(cell.text) ? cell.text : cell.link;
        if (!url) return;
        total++;
        if (!r.some((c) => PLUS.test(c.text))) return;
        marked++;
        items.push({
          cafe: get(r, "cafe"),
          car: get(r, "car"),
          date: serialToDate(get(r, "date")),
          kind: get(r, "kind") || "품질",
          url: url.trim(),
          title: get(r, "title"), // 글 제목 (영운모·넥쏘카페 네이버 검색용)
          main: get(r, "main") || get(r, "title"),
          row: headerAt + i + 2,
          sheet: sheet.name,
        });
      });
      if (marked) used.push(sheet.name);
    }
    if (!total) throw new Error("엑셀에서 게시글 주소(URL) 열을 찾지 못했습니다");
    return { items, total, sheets: used };
  }

  // RAW data 이어 쓰기용: '+' 표시와 상관없이 주소가 있는 모든 행 (엑셀에 적힌 순서대로)
  // → [{cafe, car, date(엑셀 날짜 일련번호 또는 글자), kind, url, main}]
  async function readAllRows(bytes) {
    const out = [];
    for (const sheet of await readSheets(bytes)) {
      const found = findColumns(sheet.rows);
      if (!found) continue;
      const { headerAt, col } = found;
      const get = (r, k) => (col[k] >= 0 && r[col[k]] ? r[col[k]].text.replace(/\s+/g, " ").trim() : "");
      for (const r of sheet.rows.slice(headerAt + 1)) {
        const cell = r[col.url];
        const url = cell ? (HTTP.test(cell.text) ? cell.text : cell.link) : "";
        if (!url) continue;
        out.push({ cafe: get(r, "cafe"), car: get(r, "car"), date: get(r, "date"), kind: get(r, "kind"), url: url.trim(), main: get(r, "main") });
      }
    }
    return out;
  }

  global.Excel = { readMarked, readSheets, readAllRows };
})(typeof window !== "undefined" ? window : self);
