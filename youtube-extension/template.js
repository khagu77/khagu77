// 기존 엑셀(.xlsx) 파일을 열어 특정 시트의 행만 바꿔 끼우고 나머지(서식, 다른 시트, 링크 등)는
// 그대로 둔 채 다시 저장하는 도구. 외부 라이브러리 없이 브라우저 내장 압축(CompressionStream)을 쓴다.
(function (global) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // ---------------------------------------------------------------- ZIP

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

  async function pipe(bytes, stream) {
    const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await out.arrayBuffer());
  }
  const inflate = (b) => pipe(b, new DecompressionStream("deflate-raw"));
  const deflate = (b) => pipe(b, new CompressionStream("deflate-raw"));

  // → Map(이름 → { method, crc, size, raw(압축된 바이트) })
  function readZip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("엑셀(.xlsx) 파일이 아니거나 손상된 파일입니다.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP 목록을 읽지 못했습니다.");
      const method = dv.getUint16(p + 10, true);
      const crc = dv.getUint32(p + 16, true);
      const csize = dv.getUint32(p + 20, true);
      const size = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true);
      const xlen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
      const lnlen = dv.getUint16(local + 26, true);
      const lxlen = dv.getUint16(local + 28, true);
      const start = local + 30 + lnlen + lxlen;
      entries.set(name, { method, crc, size, raw: bytes.subarray(start, start + csize) });
      p += 46 + nlen + xlen + clen;
    }
    return entries;
  }

  async function readEntry(entry) {
    if (entry.method === 0) return entry.raw;
    if (entry.method === 8) return inflate(entry.raw);
    throw new Error(`지원하지 않는 압축 방식(${entry.method})`);
  }

  function writeZip(entries) {
    const parts = [];
    const central = [];
    let offset = 0;
    for (const [name, e] of entries) {
      const nameBytes = enc.encode(name);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, e.method, true);
      local.setUint32(14, e.crc, true);
      local.setUint32(18, e.raw.length, true);
      local.setUint32(22, e.size, true);
      local.setUint16(26, nameBytes.length, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, e.raw);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, e.method, true);
      cd.setUint32(16, e.crc, true);
      cd.setUint32(20, e.raw.length, true);
      cd.setUint32(24, e.size, true);
      cd.setUint16(28, nameBytes.length, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), nameBytes);
      offset += 30 + nameBytes.length + e.raw.length;
    }
    const cdSize = central.reduce((s, x) => s + x.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.size, true);
    end.setUint16(10, entries.size, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
    let pos = 0;
    for (const x of all) {
      out.set(x, pos);
      pos += x.length;
    }
    return out;
  }

  // ---------------------------------------------------------------- XML 도우미

  const parseXml = (text) => new DOMParser().parseFromString(text, "application/xml");

  function esc(s) {
    return String(s)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, "")
      .slice(0, 32767)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function colLetter(n) {
    let s = "";
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function colIndex(letters) {
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }

  // <si> 하나의 글자(윗주 rPh 제외)
  function siText(si) {
    let s = "";
    for (const t of si.getElementsByTagName("t")) {
      if (t.parentNode.localName === "rPh" || t.parentNode.parentNode?.localName === "rPh") continue;
      s += t.textContent;
    }
    return s;
  }

  function resolvePath(base, target) {
    if (target.startsWith("/")) return target.slice(1);
    const parts = base.split("/").slice(0, -1);
    for (const seg of target.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg !== ".") parts.push(seg);
    }
    return parts.join("/");
  }

  // ---------------------------------------------------------------- 통합 문서

  class Workbook {
    static async open(bytes) {
      const wb = new Workbook();
      wb.entries = readZip(bytes);
      wb.texts = new Map(); // 읽었거나 수정한 XML (이름 → 문자열)
      wb.orig = new Map(); // 읽은 그대로의 XML - 바뀌지 않은 부분은 다시 압축하지 않기 위해
      await wb._init();
      return wb;
    }

    async text(name) {
      if (!this.texts.has(name)) {
        const e = this.entries.get(name);
        if (!e) return null;
        const text = dec.decode(await readEntry(e));
        this.texts.set(name, text);
        this.orig.set(name, text);
      }
      return this.texts.get(name);
    }

    async _init() {
      const wbXml = parseXml(await this.text("xl/workbook.xml"));
      const rels = parseXml(await this.text("xl/_rels/workbook.xml.rels"));
      const relMap = {};
      for (const r of rels.getElementsByTagName("Relationship")) {
        relMap[r.getAttribute("Id")] = { type: r.getAttribute("Type") || "", target: r.getAttribute("Target") };
      }
      this.sheets = [];
      for (const s of wbXml.getElementsByTagName("sheet")) {
        const rid =
          s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ||
          s.getAttribute("r:id");
        const rel = relMap[rid];
        if (rel) this.sheets.push({ name: s.getAttribute("name"), path: resolvePath("xl/workbook.xml", rel.target) });
      }
      const sstRel = Object.values(relMap).find((r) => r.type.endsWith("/sharedStrings"));
      this.sstPath = sstRel ? resolvePath("xl/workbook.xml", sstRel.target) : null;
      this.sst = [];
      if (this.sstPath) {
        const sst = parseXml(await this.text(this.sstPath));
        for (const si of sst.getElementsByTagName("si")) this.sst.push(siText(si));
      }
    }

    sheetNames() {
      return this.sheets.map((s) => s.name);
    }

    _sheetPath(name) {
      const s = this.sheets.find((x) => x.name === name);
      if (!s) throw new Error(`'${name}' 시트를 찾지 못했습니다.`);
      return s.path;
    }

    // → [{ r, cells: { A: 값, ... } }]  (값: 문자열 또는 숫자)
    async readRows(name) {
      const doc = parseXml(await this.text(this._sheetPath(name)));
      const out = [];
      for (const row of doc.getElementsByTagName("row")) {
        const r = Number(row.getAttribute("r"));
        const cells = {};
        for (const c of row.getElementsByTagName("c")) {
          const ref = c.getAttribute("r") || "";
          const col = ref.replace(/\d+/g, "");
          const t = c.getAttribute("t");
          const v = c.getElementsByTagName("v")[0]?.textContent;
          let val = null;
          if (t === "s") val = v !== undefined ? this.sst[Number(v)] ?? "" : null;
          else if (t === "inlineStr") val = siText(c.getElementsByTagName("is")[0] || c);
          else if (t === "str" || t === "e") val = v ?? null;
          else if (t === "b") val = v === "1";
          else if (v !== undefined && v !== "") val = Number(v);
          if (val !== null && val !== "") cells[col] = val;
        }
        out.push({ r, cells });
      }
      return out;
    }

    // keepUntil 행까지 남기고 그 아래를 newRows 로 교체한다.
    // newRows: [[A값, B값, ...], ...]   styleRow: 셀 서식을 따라 할 기존 행 번호
    async replaceRowsAfter(name, keepUntil, newRows, styleRow, { focusFirstNew = false } = {}) {
      const path = this._sheetPath(name);
      let xml = await this.text(path);
      const sdStart = xml.indexOf("<sheetData");
      const sdOpenEnd = xml.indexOf(">", sdStart) + 1;
      const selfClosing = xml[sdOpenEnd - 2] === "/";
      const sdEnd = selfClosing ? sdOpenEnd : xml.indexOf("</sheetData>", sdOpenEnd);
      const body = selfClosing ? "" : xml.slice(sdOpenEnd, sdEnd);

      const rowRe = /<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;
      const kept = [];
      let styleXml = null;
      for (const m of body.matchAll(rowRe)) {
        const r = Number(m[0].match(/\br="(\d+)"/)?.[1]);
        if (r <= keepUntil) kept.push(m[0]);
        if (r === styleRow) styleXml = m[0];
      }

      // 서식 견본: 행 속성(높이 등)과 열별 셀 서식 번호
      let rowAttrs = "";
      const cellStyles = {};
      if (styleXml) {
        const open = styleXml.match(/^<row\b([^>]*?)\/?>/)[1];
        rowAttrs = open.replace(/\s*\br="\d+"/, "").replace(/\s*\bspans="[^"]*"/, "");
        for (const c of styleXml.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"[^>]*>/g)) {
          const s = c[0].match(/\bs="(\d+)"/);
          if (s) cellStyles[c[1]] = s[1];
        }
      }

      let maxCol = 1;
      const added = newRows.map((values, i) => {
        const r = keepUntil + 1 + i;
        let cells = "";
        values.forEach((v, ci) => {
          const col = colLetter(ci + 1);
          const s = cellStyles[col] ? ` s="${cellStyles[col]}"` : "";
          if (v === null || v === undefined || v === "") {
            if (s) cells += `<c r="${col}${r}"${s}/>`;
            return;
          }
          maxCol = Math.max(maxCol, ci + 1);
          if (typeof v === "number" && isFinite(v)) cells += `<c r="${col}${r}"${s}><v>${v}</v></c>`;
          else cells += `<c r="${col}${r}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        });
        return `<row r="${r}"${rowAttrs ? " " + rowAttrs.trim() : ""}>${cells}</row>`;
      });

      const lastRow = keepUntil + newRows.length;
      xml =
        xml.slice(0, sdStart) +
        "<sheetData>" +
        kept.join("") +
        added.join("") +
        "</sheetData>" +
        xml.slice(selfClosing ? sdOpenEnd : sdEnd + "</sheetData>".length);

      // 범위 표시 갱신
      xml = xml.replace(/<dimension ref="([A-Z]+)\d+(?::([A-Z]+)\d+)?"\s*\/>/, (_, a, b) => {
        const endCol = colLetter(Math.max(colIndex(b || a), maxCol));
        return `<dimension ref="A1:${endCol}${Math.max(1, lastRow)}"/>`;
      });

      // 지운 행을 가리키던 하이퍼링크 제거
      xml = xml.replace(/<hyperlink\b[^>]*\bref="[A-Z]+(\d+)(?::[A-Z]+\d+)?"[^>]*\/>/g, (m, r) =>
        Number(r) > keepUntil ? "" : m
      );
      xml = xml.replace(/<hyperlinks>\s*<\/hyperlinks>/, "");

      // 파일을 열었을 때 보이는 위치: 새 데이터 첫 행(또는 맨 위)
      const focus = focusFirstNew && newRows.length ? keepUntil + 1 : 2;
      xml = xml.replace(/(<pane\b[^>]*\btopLeftCell=")[A-Z]+\d+(")/, `$1A${Math.max(2, focus - 3)}$2`);
      xml = xml.replace(/(<selection\b[^>]*\bactiveCell=")[A-Z]+\d+("[^>]*\bsqref=")[^"]*(")/g, `$1A${focus}$2A${focus}$3`);

      this.texts.set(path, xml);
    }

    // 시트의 셀 글자를 바꾼다. updates: { "F12": "새 글자", ... } (셀 서식은 그대로, 없는 셀은 건너뜀)
    async setCellTexts(name, updates) {
      const path = this._sheetPath(name);
      let xml = await this.text(path);
      let changed = 0;
      for (const [ref, value] of Object.entries(updates)) {
        const re = new RegExp(`<c r="${ref}"(\\s[^>]*?)?(?:/>|>[\\s\\S]*?</c>)`);
        xml = xml.replace(re, (m, attrs) => {
          changed++;
          const keep = (attrs || "").replace(/\s+t="[^"]*"/, "");
          return `<c r="${ref}"${keep} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
        });
      }
      this.texts.set(path, xml);
      return changed;
    }

    async save() {
      // 공유 문자열 사용 횟수(count) 갱신
      if (this.sstPath) {
        let count = 0;
        for (const s of this.sheets) count += ((await this.text(s.path)).match(/\bt="s"/g) || []).length;
        const sst = await this.text(this.sstPath);
        this.texts.set(this.sstPath, sst.replace(/(<sst\b[^>]*\bcount=")\d+(")/, `$1${count}$2`));
      }
      // 계산 체인은 행이 바뀌면 어긋날 수 있으므로 제거(엑셀이 다시 만든다)
      if (this.entries.has("xl/calcChain.xml")) {
        this.entries.delete("xl/calcChain.xml");
        const ct = await this.text("[Content_Types].xml");
        this.texts.set("[Content_Types].xml", ct.replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ""));
        const rels = await this.text("xl/_rels/workbook.xml.rels");
        this.texts.set("xl/_rels/workbook.xml.rels", rels.replace(/<Relationship[^>]*Target="calcChain\.xml"[^>]*\/>/, ""));
      }

      const out = new Map();
      for (const [name, e] of this.entries) {
        if (!this.modified(name)) {
          out.set(name, e);
          continue;
        }
        const data = enc.encode(this.texts.get(name));
        out.set(name, { method: 8, crc: crc32(data), size: data.length, raw: await deflate(data) });
      }
      return writeZip(out);
    }

    modified(name) {
      return this.texts.has(name) && this.texts.get(name) !== this.orig.get(name);
    }
  }

  global.XlsxTemplate = { Workbook };
})(typeof window !== "undefined" ? window : globalThis);
