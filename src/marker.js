// pngdeer's output, marked so that any clone can tell: a JPEG comment or a PNG tEXt "Software"
// entry reading "pngdeer <size>", the file's size without the mark. Recompressing pngdeer's own
// JPEG loses about another fifth each time, so the rule never measures a marked file, and a file
// edited since (its size no longer matching) is measured again.
import { crc32 } from "node:zlib";
import { kind } from "./images.js";

const LABEL = /^pngdeer (\d+)$/;

/** `bytes` with the mark added (a PNG or JPEG; anything else comes back as is). */
export function mark(bytes) {
  const type = kind(bytes);
  const text = Buffer.from(`pngdeer ${bytes.length}`, "latin1");
  if (type === "png") {
    // a tEXt chunk right after IHDR (8 bytes of signature, 25 of IHDR)
    const data = Buffer.concat([Buffer.from("Software\0", "latin1"), text]);
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write("tEXt", 4, "latin1");
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
    return Buffer.concat([bytes.subarray(0, 33), chunk, bytes.subarray(33)]);
  }
  if (type === "jpeg") {
    // a COM segment after SOI and the APPn segments, which JFIF and Exif readers expect first
    let pos = 2;
    while (pos + 4 <= bytes.length && bytes[pos] === 0xff && bytes[pos + 1] >= 0xe0 && bytes[pos + 1] <= 0xef) pos += 2 + ((bytes[pos + 2] << 8) | bytes[pos + 3]);
    const segment = Buffer.alloc(4 + text.length);
    segment.writeUInt16BE(0xfffe, 0);
    segment.writeUInt16BE(2 + text.length, 2);
    text.copy(segment, 4);
    return Buffer.concat([bytes.subarray(0, pos), segment, bytes.subarray(pos)]);
  }
  return bytes;
}

/** Whether `bytes` carry the mark, and haven't changed size since. */
export function marked(bytes) {
  const type = kind(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const matches = (text, added) => Number(LABEL.exec(text)?.[1]) === bytes.length - added;
  if (type === "png") {
    for (let pos = 8; pos + 12 <= bytes.length; pos += 12 + view.getUint32(pos)) {
      const chunk = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
      if (chunk === "IDAT" || chunk === "IEND") break;
      const length = view.getUint32(pos);
      if (chunk === "tEXt" && pos + 8 + length <= bytes.length) {
        const [keyword, text] = Buffer.from(bytes.subarray(pos + 8, pos + 8 + length)).toString("latin1").split("\0");
        if (keyword === "Software" && matches(text, 12 + length)) return true;
      }
    }
  } else if (type === "jpeg") {
    // the segments before the scan (SOS), each FF xx and a length that counts itself
    for (let pos = 2; pos + 4 <= bytes.length && bytes[pos] === 0xff && bytes[pos + 1] !== 0xda; pos += 2 + view.getUint16(pos + 2)) {
      const length = view.getUint16(pos + 2);
      if (bytes[pos + 1] === 0xfe && matches(Buffer.from(bytes.subarray(pos + 4, pos + 2 + length)).toString("latin1"), 2 + length)) return true;
    }
  }
  return false;
}
