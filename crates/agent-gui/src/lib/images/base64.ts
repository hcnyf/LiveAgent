/**
 * base64 ↔ 字节。两端协议（OpenAI 的 `b64_json`、Gemini 的 `inlineData.data`）
 * 都以 base64 承载图片，转字节只为 multipart 上传与本地缓存。
 *
 * 分块处理：`String.fromCharCode(...bytes)` 在几 MB 的图上会直接爆栈
 * （参数个数上限），所以一律按 32 KiB 切片。
 */

export function decodeBase64ToBytes(dataBase64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(dataBase64);
  // 显式以 ArrayBuffer 构造：`new Uint8Array(length)` 的类型是
  // `Uint8Array<ArrayBufferLike>`，无法直接作为 `BlobPart`（multipart 上传要用）。
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function encodeBytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
