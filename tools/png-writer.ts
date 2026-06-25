// Minimal dependency-free PNG encoder using Node.js built-in zlib.
// Supports 32-bit RGBA images only.

import { deflateSync } from "node:zlib";

// CRC32 (IEEE 802.3) — required for PNG chunk integrity.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = (CRC_TABLE[(crc ^ b) & 0xff]!) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length);
  // CRC covers type + data
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBuf);
  crcInput.set(data, 4);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([lenBuf, typeBuf, Buffer.from(data), crcBuf]);
}

/**
 * Encode a 32-bit RGBA image as a PNG Buffer.
 * `rgba`: flat Uint8Array of (r,g,b,a) bytes in row-major order, top row first.
 * No external dependencies — uses only Node.js built-in zlib.
 */
export function encodePNG(width: number, height: number, rgba: Uint8Array): Buffer {
  // IHDR: 13 bytes
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width, false);
  dv.setUint32(4, height, false);
  ihdr[8] = 8;  // bit depth per channel
  ihdr[9] = 6;  // colour type: RGBA
  // bytes 10-12: compression=0, filter=0, interlace=0 (already 0)

  // IDAT: prefix each scanline with filter byte 0 (None), then deflate
  const stride = width * 4;
  const filtered = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0;  // filter type None
    filtered.set(rgba.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),  // PNG signature
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", new Uint8Array(deflateSync(filtered))),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}
