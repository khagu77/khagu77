// 엑셀 내려받기 (SheetJS) — 순번 · 채널 · 매체명 · 게시일 · 수집일 · 제목 · URL(링크) · 성향 · 근거 · 키워드 · 유사건수 · 메모
import { CH, SENT, fmtTime, toast } from "./ui.js";

let XLSX;
export async function exportExcel(posts, catName, settings) {
  if (!posts.length) return toast("내려받을 글이 없습니다", "err");
  XLSX ||= await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
  const catNames = Object.fromEntries((settings.categories || []).map((c) => [c.id, c.name]));
  const rows = posts.map((p, i) => ({
    순번: i + 1,
    채널: CH[p.channel]?.name || p.channel,
    매체명: p.source || "",
    게시일: p.postedAt ? fmtTime(p.postedAt, true) : p.postedDay || "",
    수집일: fmtTime(p.collectedAt, true),
    제목: p.title,
    URL: p.url,
    성향: SENT[p.sentiment]?.name || "",
    "성향 판단": p.sentimentBy === "rule" ? "규칙" : p.sentimentBy === "manual" ? "담당자" : p.sentimentBy ? `AI(${p.sentimentBy})` : "",
    "판단 근거": p.sentimentReason || "",
    키워드: (p.kw || []).join(", "),
    카테고리: (p.cats || []).filter((c) => c !== "all").map((c) => catNames[c] || c).join(", "),
    "유사 기사": p.dupCount || "",
    "카톡 발송": p.alerted ? fmtTime(p.alertedAt, true) : "",
    중요: p.star ? "★" : "",
    메모: p.memo || "",
    내용: p.desc || "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [6, 9, 18, 17, 17, 60, 45, 8, 10, 28, 24, 22, 8, 17, 5, 24, 60].map((wch) => ({ wch }));
  ws["!autofilter"] = { ref: ws["!ref"] };
  rows.forEach((r, i) => {
    const cell = ws[XLSX.utils.encode_cell({ r: i + 1, c: 6 })];
    if (cell) cell.l = { Target: r.URL };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "게시물");
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  XLSX.writeFile(wb, `${ymd}_${catName.replace(/[\\/:*?"<>|()\s]+/g, "_")}_게시물_${posts.length}건.xlsx`);
  toast(`엑셀 ${posts.length}건을 내려받았습니다`);
}
