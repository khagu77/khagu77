// 일일 부정 이슈 수집 엑셀(.xlsx/.xltx)에서 '+' 표시된 게시물만 골라낸다.
// 머리글 이름으로 열을 찾으므로 열 순서가 바뀌어도 된다.
(function (global) {
  const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

  const HEADERS = {
    cafe: ["커뮤니티명", "커뮤니티", "매체", "카페명"],
    car: ["차종"],
    date: ["게시일", "작성일"],
    kind: ["구분", "유형"],
    url: ["URL", "url", "링크"],
    main: ["주요 내용", "주요내용", "내용"],
  };

  const parseXml = (u8) => new DOMParser().parseFromString(Zip.text(u8), "application/xml");

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
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
    return d.toISOString().slice(0, 10);
  }

  async function readRows(bytes) {
    const files = await Zip.read(bytes);
    const shared = [];
    if (files.has("xl/sharedStrings.xml")) {
      for (const si of parseXml(files.get("xl/sharedStrings.xml")).getElementsByTagNameNS(NS, "si")) {
        shared.push([...si.getElementsByTagNameNS(NS, "t")].map((x) => x.textContent).join(""));
      }
    }
    // 첫 번째 시트
    const wb = parseXml(files.get("xl/workbook.xml"));
    const sheet = wb.getElementsByTagNameNS(NS, "sheet")[0];
    const rid = sheet.getAttributeNS(REL_NS, "id");
    const rels = parseXml(files.get("xl/_rels/workbook.xml.rels"));
    let target = "worksheets/sheet1.xml";
    for (const r of rels.getElementsByTagName("Relationship")) {
      if (r.getAttribute("Id") === rid) target = r.getAttribute("Target");
    }
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const doc = parseXml(files.get(path));
    const rows = [];
    for (const row of doc.getElementsByTagNameNS(NS, "row")) {
      const arr = [];
      for (const c of row.getElementsByTagNameNS(NS, "c")) arr[colIndex(c.getAttribute("r"))] = cellText(c, shared);
      rows.push(arr.map((v) => (v == null ? "" : String(v))));
    }
    return rows;
  }

  // → { items: [{cafe, car, date, kind, url, main, row}], total }
  async function readMarked(bytes) {
    const rows = await readRows(bytes);
    const headerAt = rows.findIndex((r) => r.some((v) => /^url$/i.test(v.trim())));
    if (headerAt < 0) throw new Error("엑셀에서 'URL' 머리글을 찾지 못했습니다");
    const header = rows[headerAt].map((v) => v.trim());
    const col = {};
    for (const [key, names] of Object.entries(HEADERS)) {
      col[key] = header.findIndex((h) => names.includes(h));
    }
    if (col.url < 0) throw new Error("엑셀에서 'URL' 열을 찾지 못했습니다");
    const get = (r, k) => (col[k] >= 0 ? (r[col[k]] || "").trim() : "");
    const items = [];
    let total = 0;
    rows.slice(headerAt + 1).forEach((r, i) => {
      const url = get(r, "url");
      if (!url) return;
      total++;
      if (!r.some((v) => v.trim() === "+")) return;
      items.push({
        cafe: get(r, "cafe"),
        car: get(r, "car"),
        date: serialToDate(get(r, "date")),
        kind: get(r, "kind") || "품질",
        url,
        main: get(r, "main"),
        row: headerAt + i + 2,
      });
    });
    return { items, total };
  }

  global.Excel = { readMarked, readRows };
})(typeof window !== "undefined" ? window : self);
