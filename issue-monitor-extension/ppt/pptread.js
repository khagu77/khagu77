// 완성된 보고서 PPT 읽기: 담당자가 고친 PPT 에서 상세 슬라이드·2페이지 요약표의 값을 꺼낸다 (자동 학습용)
// 상세 슬라이드 표: (0,1) 차종 (0,3) 제원 (0,5) 유형(주의/경고/심각 중 색칠된 것이 불만 구분) (0,7) 경과
//                  (1,1) 매체 (1,3) 게시글 위치 (3,1) 본문 요약 + 댓글 반응, 제목 상자 "■ …", "No.N"
// 2페이지 요약표 행: No / 차종 / 유형 / 내용 요약 / 댓글수 / 신규·중복 / 입고·운행지역 / 집중관리고객
(function (global) {
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const LEVEL_BY_COLOR = { "00B050": "주의", "0563C1": "경고", C00000: "심각" };
  const dec = new TextDecoder();

  const all = (n, ns, name) => [...n.getElementsByTagNameNS(ns, name)];
  const kids = (n, ns, name) => [...n.childNodes].filter((c) => c.namespaceURI === ns && c.localName === name);
  const paraText = (p) => all(p, A, "t").map((t) => t.textContent).join("");
  const cellParas = (tc) => all(tc, A, "p").map(paraText).map((s) => s.trim());
  const cellText = (tc) => cellParas(tc).filter(Boolean).join(" ").trim();

  function levelOf(tc) {
    for (const r of all(tc, A, "r")) {
      const t = all(r, A, "t").map((x) => x.textContent).join("").trim();
      const clr = all(r, A, "srgbClr")[0];
      if (clr && /^(주의|경고|심각)$/.test(t)) return t;
      if (clr && LEVEL_BY_COLOR[clr.getAttribute("val")] && /주의|경고|심각/.test(t)) return t.match(/주의|경고|심각/)[0];
    }
    return "";
  }

  async function read(bytes) {
    const files = await Zip.read(bytes);
    const names = [...files.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
    const details = [];
    const summary = new Map();
    for (const n of names) {
      const doc = new DOMParser().parseFromString(dec.decode(files.get(n)), "application/xml");
      const tbls = all(doc, A, "tbl");
      const shapes = all(doc, P, "sp").map((sp) => all(sp, A, "p").map(paraText).join("").trim());
      const title = shapes.find((t) => t.startsWith("■"));
      const noText = shapes.find((t) => /^No\.\s*\d+$/i.test(t));
      if (title && tbls.length) {
        const rows = kids(tbls[0], A, "tr").map((tr) => kids(tr, A, "tc"));
        const c = (r, k) => (rows[r] && rows[r][k]) || null;
        const urlCell = c(1, 3) ? cellText(c(1, 3)) : "";
        const kindCell = c(0, 5) ? cellText(c(0, 5)) : "";
        const bodyParas = c(3, 1) ? cellParas(c(3, 1)).filter(Boolean) : [];
        const reactLine = bodyParas.find((s) => /^댓글 반응/.test(s)) || "";
        details.push({
          no: noText ? +noText.replace(/\D/g, "") : null,
          title: title.replace(/^■\s*/, ""),
          code: c(0, 1) ? cellText(c(0, 1)) : "",
          spec: c(0, 3) ? cellText(c(0, 3)) : "",
          kind: (kindCell.match(/^(품질|응대|결품|제도)/) || [])[1] || "",
          level: c(0, 5) ? levelOf(c(0, 5)) : "",
          progress: c(0, 7) ? cellText(c(0, 7)) : "",
          cafe: c(1, 1) ? cellText(c(1, 1)).replace(/^동호회\s*/, "") : "",
          url: (urlCell.match(/https?:\/\/\S+/) || [""])[0],
          body: bodyParas.filter((s) => !/^댓글 반응/.test(s)).join(" "),
          reaction: reactLine === "댓글 반응 없음" ? "" : reactLine.replace(/^댓글 반응\s*:\s*/, ""),
        });
      } else if (tbls.length) {
        // 2페이지 요약표 (머리글에 '내용 요약'이 있는 표)
        const rows = kids(tbls[0], A, "tr").map((tr) => kids(tr, A, "tc").map(cellText));
        if (!rows.length || !rows[0].some((h) => /내용\s*요약/.test(h))) continue;
        for (const r of rows.slice(1)) {
          const no = +String(r[0] || "").replace(/\D/g, "");
          if (!no || !r[3]) continue;
          summary.set(no, { code: r[1], kind: r[2], short: r[3], duplicate: r[5], region: r[6], focus: r[7] });
        }
      }
    }
    for (const d of details) Object.assign(d, summary.get(d.no) ? { short: summary.get(d.no).short, duplicate: summary.get(d.no).duplicate, region: summary.get(d.no).region, focus: summary.get(d.no).focus } : {});
    return details;
  }

  global.PptRead = { read };
})(window);
