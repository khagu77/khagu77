// 손으로 그린 SVG 차트 (그려지는 애니메이션 · 마우스 올리면 툴팁)
import { esc, fmtNum, cssVar, h } from "./ui.js";

let tipEl;
function tip() {
  if (!tipEl) { tipEl = h(`<div class="tip"></div>`); document.body.append(tipEl); }
  return tipEl;
}
export function showTip(e, html) {
  const t = tip();
  t.innerHTML = html;
  t.classList.add("on");
  const r = t.getBoundingClientRect();
  let x = e.clientX + 14;
  let y = e.clientY + 14;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
}
export const hideTip = () => tip().classList.remove("on");

const niceMax = (v) => {
  if (v <= 5) return 5;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
};

// 누적 막대 (x축: 날짜/시간, 계열: 채널)
export function stackedBars(el, { labels, series, height = 260, hidden = new Set() }) {
  const W = Math.max(320, el.clientWidth || 600);
  const H = height;
  const pad = { l: 40, r: 10, t: 12, b: 26 };
  const vis = series.filter((s) => !hidden.has(s.key));
  const totals = labels.map((_, i) => vis.reduce((a, s) => a + (s.values[i] || 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const bw = iw / labels.length;
  const barW = Math.max(3, Math.min(34, bw * 0.62));
  const y = (v) => pad.t + ih - (v / max) * ih;
  let g = "";
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k;
    g += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${fmtNum(v)}</text>`;
  }
  const every = Math.ceil(labels.length / Math.max(4, Math.floor(iw / 56)));
  let xl = "";
  labels.forEach((l, i) => { if (i % every === 0 || i === labels.length - 1) xl += `<text x="${pad.l + bw * i + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`; });
  let bars = "";
  labels.forEach((_, i) => {
    let acc = 0;
    const x = pad.l + bw * i + (bw - barW) / 2;
    vis.forEach((s, si) => {
      const v = s.values[i] || 0;
      if (!v) return;
      const y0 = y(acc);
      const y1 = y(acc + v);
      acc += v;
      const hgt = Math.max(0, y0 - y1 - (si ? 1.5 : 0));
      const top = acc === totals[i];
      bars += `<rect class="bar" style="animation-delay:${i * 22}ms" x="${x}" y="${y1}" width="${barW}" height="${hgt}" rx="${top ? 4 : 0}" fill="var(${s.color})"/>`;
    });
    bars += `<rect class="hot" data-i="${i}" x="${pad.l + bw * i}" y="${pad.t}" width="${bw}" height="${ih}" fill="transparent"/>`;
  });
  el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" height="${H}"><g class="axis">${g}${xl}</g>${bars}</svg>`;
  el.querySelectorAll(".hot").forEach((r) => {
    r.addEventListener("mousemove", (e) => {
      const i = +r.dataset.i;
      const rows = vis.map((s) => `<div class="row"><span><i style="background:var(${s.color})"></i>${esc(s.name)}</span><b>${fmtNum(s.values[i] || 0)}</b></div>`).join("");
      showTip(e, `<b>${esc(labels[i])} · 합계 ${fmtNum(totals[i])}</b>${rows}`);
    });
    r.addEventListener("mouseleave", hideTip);
  });
}

// 선 + 영역 (부정 비율 추이 등)
export function lineChart(el, { labels, series, height = 220, unit = "", max: forceMax }) {
  const W = Math.max(320, el.clientWidth || 600);
  const H = height;
  const pad = { l: 40, r: 12, t: 14, b: 26 };
  const all = series.flatMap((s) => s.values);
  const max = forceMax || niceMax(Math.max(1, ...all));
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i) => pad.l + (labels.length <= 1 ? iw / 2 : (iw * i) / (labels.length - 1));
  const y = (v) => pad.t + ih - (v / max) * ih;
  let g = "";
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k;
    g += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${fmtNum(v)}${unit}</text>`;
  }
  const every = Math.ceil(labels.length / Math.max(4, Math.floor(iw / 60)));
  labels.forEach((l, i) => { if (i % every === 0 || i === labels.length - 1) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`; });
  let paths = "";
  series.forEach((s, si) => {
    const pts = s.values.map((v, i) => [x(i), y(v || 0)]);
    const d = pts.map((p, i) => {
      if (!i) return `M${p[0]},${p[1]}`;
      const q = pts[i - 1];
      const cx = (q[0] + p[0]) / 2;
      return `C${cx},${q[1]} ${cx},${p[1]} ${p[0]},${p[1]}`;
    }).join(" ");
    const gid = `lg${Math.random().toString(36).slice(2, 7)}`;
    if (si === 0) {
      paths += `<defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(${s.color})" stop-opacity=".35"/><stop offset="1" stop-color="var(${s.color})" stop-opacity="0"/></linearGradient></defs>`;
      paths += `<path class="area" d="${d} L${x(labels.length - 1)},${y(0)} L${x(0)},${y(0)} Z" fill="url(#${gid})"/>`;
    }
    paths += `<path class="draw" d="${d}" fill="none" stroke="var(${s.color})" stroke-width="2.2" stroke-linecap="round"/>`;
  });
  el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" height="${H}"><g class="axis">${g}</g>${paths}<line class="xh" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" stroke="var(--line-2)" style="opacity:0"/><g class="dots"></g><rect class="ov" x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
  el.querySelectorAll("path.draw").forEach((p) => { const L = p.getTotalLength(); p.style.setProperty("--len", L); });
  const svg = el.querySelector("svg");
  const ov = el.querySelector(".ov");
  const xh = el.querySelector(".xh");
  const dots = el.querySelector(".dots");
  ov.addEventListener("mousemove", (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(labels.length - 1, Math.round(((px - pad.l) / iw) * (labels.length - 1))));
    xh.setAttribute("x1", x(i)); xh.setAttribute("x2", x(i)); xh.style.opacity = 1;
    dots.innerHTML = series.map((s) => `<circle cx="${x(i)}" cy="${y(s.values[i] || 0)}" r="5" fill="var(${s.color})" stroke="var(--panel-solid)" stroke-width="2"/>`).join("");
    showTip(e, `<b>${esc(labels[i])}</b>${series.map((s) => `<div class="row"><span><i style="background:var(${s.color})"></i>${esc(s.name)}</span><b>${fmtNum(Math.round((s.values[i] || 0) * 10) / 10)}${unit}</b></div>`).join("")}`);
  });
  ov.addEventListener("mouseleave", () => { hideTip(); xh.style.opacity = 0; dots.innerHTML = ""; });
}

// 도넛 (성향 비율) — 시계 방향으로 채워지는 애니메이션
export function donut(el, { parts, center, sub }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const R = 62;
  const C = 2 * Math.PI * R;
  let off = 0;
  let segs = "";
  parts.forEach((p, i) => {
    const len = (p.value / total) * C;
    if (!p.value) return;
    const gap = parts.filter((x) => x.value).length > 1 ? 2 : 0;
    segs += `<circle class="donut-seg" data-i="${i}" cx="85" cy="85" r="${R}" fill="none" stroke="var(${p.color})" stroke-width="20"
      stroke-dasharray="0 ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 85 85)" data-len="${Math.max(0, len - gap)}" style="transition: stroke-dasharray 1.1s ${i * 0.12}s cubic-bezier(.2,.8,.2,1), stroke-width .25s"/>`;
    off += len;
  });
  el.innerHTML = `<svg viewBox="0 0 170 170"><circle cx="85" cy="85" r="${R}" fill="none" stroke="var(--line)" stroke-width="20"/>${segs}
    <text class="donut-center" x="85" y="88" text-anchor="middle">${esc(center)}</text><text class="donut-sub" x="85" y="106" text-anchor="middle">${esc(sub)}</text></svg>`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.querySelectorAll(".donut-seg").forEach((c) => c.setAttribute("stroke-dasharray", `${c.dataset.len} ${C}`));
  }));
  el.querySelectorAll(".donut-seg").forEach((c) => {
    const p = parts[+c.dataset.i];
    c.addEventListener("mousemove", (e) => showTip(e, `<b>${esc(p.name)}</b><div class="row"><span>${fmtNum(p.value)}건</span><b>${((p.value / total) * 100).toFixed(1)}%</b></div>`));
    c.addEventListener("mouseleave", hideTip);
  });
}

export function sparkline(values, color = "--brand") {
  const W = 120;
  const H = 44;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [values.length <= 1 ? W : (W * i) / (values.length - 1), H - 4 - (v / max) * (H - 10)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const id = `sp${Math.random().toString(36).slice(2, 7)}`;
  return `<svg class="spark chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(${color})" stop-opacity=".35"/><stop offset="1" stop-color="var(${color})" stop-opacity="0"/></linearGradient></defs>
    <path class="area" d="${d} L${W},${H} L0,${H} Z" fill="url(#${id})"/><path class="draw" style="--len:400" d="${d}" fill="none" stroke="var(${color})" stroke-width="2" stroke-linecap="round"/></svg>`;
}

export function heat(el, values, color = "--brand") {
  const max = Math.max(1, ...values);
  el.innerHTML = `<div class="heat">${values.map((v, i) => `<div style="--i:${i};background:color-mix(in srgb, var(${color}) ${v ? 12 + (v / max) * 88 : 0}%, rgba(127,150,220,.08))" data-h="${i}" data-v="${v}"></div>`).join("")}</div>
    <div class="heat-axis">${values.map((_, i) => `<span>${i % 3 === 0 ? i : ""}</span>`).join("")}</div>`;
  el.querySelectorAll("[data-h]").forEach((c) => {
    c.addEventListener("mousemove", (e) => showTip(e, `<b>${c.dataset.h}시</b>${fmtNum(c.dataset.v)}건`));
    c.addEventListener("mouseleave", hideTip);
  });
}

export const color = cssVar;
