// 백업 폴더에서 복구: 크롬이 확장 저장소를 기록하는 LevelDB 파일(.log / .ldb)을 직접 읽어
// 덮어쓰기 전에 남아 있던 옛 값(데일리 DB·지난 결과)을 찾아낸다.
// (맥: ~/Library/Application Support/Google/Chrome/Default/Local Extension Settings/<확장 ID> 를 복사해 둔 폴더)

const LevelRecover = (() => {
  // --- 가변 길이 정수 ---
  function varint(u8, pos) {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = u8[pos.i++];
      result += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80 && pos.i < u8.length);
    return result;
  }

  // --- Snappy 압축 풀기 (.ldb 블록) ---
  function snappy(src) {
    const pos = { i: 0 };
    const len = varint(src, pos);
    const out = new Uint8Array(len);
    let o = 0;
    let i = pos.i;
    while (i < src.length) {
      const tag = src[i++];
      const t = tag & 3;
      if (t === 0) {
        let n = tag >> 2;
        if (n >= 60) {
          const bytes = n - 59;
          n = 0;
          for (let k = 0; k < bytes; k++) n |= src[i++] << (8 * k);
        }
        n += 1;
        out.set(src.subarray(i, i + n), o);
        i += n;
        o += n;
      } else {
        let n;
        let off;
        if (t === 1) {
          n = ((tag >> 2) & 7) + 4;
          off = ((tag >> 5) << 8) | src[i++];
        } else if (t === 2) {
          n = (tag >> 2) + 1;
          off = src[i] | (src[i + 1] << 8);
          i += 2;
        } else {
          n = (tag >> 2) + 1;
          off = (src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24)) >>> 0;
          i += 4;
        }
        for (let k = 0; k < n; k++, o++) out[o] = out[o - off];
      }
    }
    return out.subarray(0, o);
  }

  const dec = new TextDecoder("utf-8", { fatal: false });

  // --- .log (쓰기 기록): 32KB 블록 안의 레코드 → WriteBatch ---
  function parseLog(u8, out) {
    const BLOCK = 32768;
    let i = 0;
    let frag = [];
    while (i + 7 <= u8.length) {
      const left = BLOCK - (i % BLOCK);
      if (left < 7) {
        i += left;
        continue;
      }
      const len = u8[i + 4] | (u8[i + 5] << 8);
      const type = u8[i + 6];
      if (type === 0 && len === 0) {
        i += left; // 블록 끝 채움
        continue;
      }
      const data = u8.subarray(i + 7, i + 7 + len);
      i += 7 + len;
      if (type === 1) batch(data, out); // FULL
      else if (type === 2) frag = [data]; // FIRST
      else if (type === 3) frag.push(data); // MIDDLE
      else if (type === 4) {
        frag.push(data);
        const all = new Uint8Array(frag.reduce((s, x) => s + x.length, 0));
        let o = 0;
        for (const x of frag) {
          all.set(x, o);
          o += x.length;
        }
        batch(all, out);
        frag = [];
      }
    }
  }

  function batch(d, out) {
    if (d.length < 12) return;
    let seq = 0;
    for (let k = 7; k >= 0; k--) seq = seq * 256 + d[k];
    const count = d[8] | (d[9] << 8) | (d[10] << 16) | (d[11] << 24);
    const pos = { i: 12 };
    for (let n = 0; n < count && pos.i < d.length; n++) {
      const t = d[pos.i++];
      const kl = varint(d, pos);
      const key = dec.decode(d.subarray(pos.i, pos.i + kl));
      pos.i += kl;
      if (t === 1) {
        const vl = varint(d, pos);
        out.push({ key, seq: seq + n, value: d.subarray(pos.i, pos.i + vl) });
        pos.i += vl;
      }
    }
  }

  // --- .ldb (정리된 테이블): footer → index 블록 → data 블록 ---
  function readBlock(u8, off, size) {
    const raw = u8.subarray(off, off + size);
    const type = u8[off + size];
    return type === 1 ? snappy(raw) : raw;
  }

  function blockEntries(b, cb) {
    if (b.length < 4) return;
    const nRestarts = b[b.length - 4] | (b[b.length - 3] << 8) | (b[b.length - 2] << 16) | (b[b.length - 1] << 24);
    const end = b.length - 4 - 4 * nRestarts;
    const pos = { i: 0 };
    let last = new Uint8Array(0);
    while (pos.i < end) {
      const shared = varint(b, pos);
      const nonShared = varint(b, pos);
      const vl = varint(b, pos);
      const key = new Uint8Array(shared + nonShared);
      key.set(last.subarray(0, shared), 0);
      key.set(b.subarray(pos.i, pos.i + nonShared), shared);
      pos.i += nonShared;
      const val = b.subarray(pos.i, pos.i + vl);
      pos.i += vl;
      last = key;
      cb(key, val);
    }
  }

  function parseTable(u8, out) {
    if (u8.length < 48) return;
    const foot = u8.subarray(u8.length - 48);
    const p = { i: 0 };
    varint(foot, p); // metaindex offset
    varint(foot, p); // metaindex size
    const io = varint(foot, p);
    const is = varint(foot, p);
    const index = readBlock(u8, io, is);
    blockEntries(index, (_k, handle) => {
      const hp = { i: 0 };
      const off = varint(handle, hp);
      const size = varint(handle, hp);
      let data;
      try {
        data = readBlock(u8, off, size);
      } catch {
        return;
      }
      blockEntries(data, (ikey, val) => {
        if (ikey.length < 8) return;
        const tag = ikey.subarray(ikey.length - 8);
        if (tag[0] !== 1) return; // 1 = 값, 0 = 삭제
        let seq = 0;
        for (let k = 7; k >= 1; k--) seq = seq * 256 + tag[k];
        out.push({ key: dec.decode(ikey.subarray(0, ikey.length - 8)), seq, value: val });
      });
    });
  }

  // files: [{ name, bytes }] → 키별 모든 버전(옛 값 포함)
  function scan(files) {
    const recs = [];
    for (const f of files) {
      try {
        if (/\.log$/i.test(f.name)) parseLog(f.bytes, recs);
        else if (/\.(ldb|sst)$/i.test(f.name)) parseTable(f.bytes, recs);
      } catch {
        /* 깨진 파일은 건너뜀 */
      }
    }
    return recs;
  }

  // 데일리 DB 의 모든 옛 버전에서 수집 기록(id 별로 행이 가장 많은 버전)과 지난 결과 버전을 모은다
  function findRuns(files) {
    const recs = scan(files);
    const runs = new Map();
    const lastResults = [];
    for (const r of recs) {
      if (r.key !== "dailyDb" && r.key !== "lastResult") continue;
      let v;
      try {
        v = JSON.parse(dec.decode(r.value));
      } catch {
        continue;
      }
      if (r.key === "dailyDb" && Array.isArray(v)) {
        for (const e of v) {
          if (!e || !e.id || !Array.isArray(e.rows)) continue;
          const prev = runs.get(e.id);
          if (!prev || e.rows.length > prev.rows.length) runs.set(e.id, e);
        }
      } else if (r.key === "lastResult" && v && Array.isArray(v.rows) && v.rows.length) {
        lastResults.push({ ...v, seq: r.seq });
      }
    }
    // 지난 결과는 기간별로 행이 가장 많은 것만
    const lr = new Map();
    for (const v of lastResults) {
      const k = v.range ? `${v.range.start}-${v.range.end}` : "none";
      if (!lr.has(k) || v.rows.length > lr.get(k).rows.length) lr.set(k, v);
    }
    return { runs: [...runs.values()], lastResults: [...lr.values()], records: recs.length };
  }

  return { findRuns, snappy };
})();

if (typeof module !== "undefined") module.exports = LevelRecover;
