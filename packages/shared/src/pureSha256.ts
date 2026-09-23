/**
 * 纯 TypeScript 实现的标准 SHA-256 (FIPS 180-4)。
 *
 * 背景与第一性原理：
 * 浏览器端在非安全上下文（如局域网 HTTP 访问 `http://192.168.x.x:5173/` 或内网非 HTTPS 环境）下，
 * `globalThis.crypto?.subtle` 会被浏览器安全策略强制设为 `undefined`。
 * 若无回退实现，任何基于哈希校验的传输（如附件分片上传、文件指纹等）在局域网直接抛出异常崩溃。
 * 本模块不依赖任何外部 npm 包或 Node.js 内置模块，跨 Browser / Node / Worker / Electron 全平台一致。
 */

// SHA-256 轮常数 (K0 - K63)
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/**
 * 纯 TypeScript 计算 Uint8Array 的 SHA-256 哈希值，返回小写 64 字符十六进制字符串。
 */
export function pureSha256(data: Uint8Array): string {
  const dataLen = data.length;
  // 填充：原始数据 + 0x80 + 0 填充 + 64-bit 大端长度（比特数）
  // 块大小 64 字节，总长度满足 (dataLen + 1 + 8 + padding) % 64 === 0
  const paddedLen = Math.ceil((dataLen + 9) / 64) * 64;
  const buffer = new Uint8Array(paddedLen);
  buffer.set(data);
  buffer[dataLen] = 0x80;

  // 写入 64-bit 长度（以 bit 为单位，大端顺序）
  const bitLength = BigInt(dataLen) * 8n;
  const view = new DataView(buffer.buffer);
  view.setBigUint64(paddedLen - 8, bitLength, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const wi15 = w[i - 15]!;
      const wi2 = w[i - 2]!;
      const wi16 = w[i - 16]!;
      const wi7 = w[i - 7]!;
      const s0 = rotr(wi15, 7) ^ rotr(wi15, 18) ^ (wi15 >>> 3);
      const s1 = rotr(wi2, 17) ^ rotr(wi2, 19) ^ (wi2 >>> 10);
      w[i] = ((wi16 + s0) | 0) + (((wi7 + s1) | 0) | 0);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const ki = K[i]!;
      const wi = w[i]!;
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + ki + wi) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  return [
    (h0 >>> 0).toString(16).padStart(8, "0"),
    (h1 >>> 0).toString(16).padStart(8, "0"),
    (h2 >>> 0).toString(16).padStart(8, "0"),
    (h3 >>> 0).toString(16).padStart(8, "0"),
    (h4 >>> 0).toString(16).padStart(8, "0"),
    (h5 >>> 0).toString(16).padStart(8, "0"),
    (h6 >>> 0).toString(16).padStart(8, "0"),
    (h7 >>> 0).toString(16).padStart(8, "0"),
  ].join("");
}

/**
 * 优先利用原生 SubtleCrypto（安全上下文极速硬件加速），若不可用则平滑降级至纯 TS SHA-256。
 */
export async function sha256HexAsync(bytes: Uint8Array): Promise<string> {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle?.digest) {
    try {
      const digest = await globalThis.crypto.subtle.digest(
        "SHA-256",
        Uint8Array.from(bytes).buffer,
      );
      return [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      // 降级使用纯 JS 实现
    }
  }
  return pureSha256(bytes);
}
