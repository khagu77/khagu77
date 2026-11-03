// .xlsx / .pptx (ZIP) 읽기·쓰기. 외부 라이브러리 없이 브라우저의 (De)CompressionStream 을 쓴다.
// Zip.read(bytes) → Map(이름 → Uint8Array), Zip.write(Map) → Uint8Array
(function (global) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

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

  async function read(bytes) {
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("ZIP 형식이 아닙니다");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = new Map();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP 목록이 손상되었습니다");
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      const lNameLen = dv.getUint16(local + 26, true);
      const lExtraLen = dv.getUint16(local + 28, true);
      const start = local + 30 + lNameLen + lExtraLen;
      const raw = bytes.subarray(start, start + csize);
      let data;
      if (method === 0) data = raw.slice();
      else if (method === 8) data = await pipe(raw, new DecompressionStream("deflate-raw"));
      else throw new Error(`지원하지 않는 압축 방식(${method}): ${name}`);
      if (!name.endsWith("/")) files.set(name, data);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  // 이미 압축된 그림은 그대로(store), 나머지(XML 등)는 deflate.
  async function write(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    for (const [nameStr, value] of files) {
      const name = enc.encode(nameStr);
      const data = typeof value === "string" ? enc.encode(value) : value;
      const crc = crc32(data);
      const store = /\.(png|jpe?g|gif|mp4|m4a|zip)$/i.test(nameStr);
      const body = store ? data : await pipe(data, new CompressionStream("deflate-raw"));
      const method = store ? 0 : 8;

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, method, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, body.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      parts.push(new Uint8Array(local.buffer), name, body);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, method, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, body.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + body.length;
    }
    const cdSize = central.reduce((s, x) => s + x.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.size, true);
    end.setUint16(10, files.size, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
    let o = 0;
    for (const x of all) {
      out.set(x, o);
      o += x.length;
    }
    return out;
  }

  global.Zip = { read, write, text: (u8) => dec.decode(u8), bytes: (s) => enc.encode(s) };
})(typeof window !== "undefined" ? window : self);
