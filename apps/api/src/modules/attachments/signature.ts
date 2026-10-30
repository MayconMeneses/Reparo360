import type { AttachmentType } from "@reparo360/domain";

const startsWith = (data: Buffer, bytes: number[], offset = 0) =>
  data.length >= offset + bytes.length && bytes.every((byte, i) => data[offset + i] === byte);

/**
 * Identifica o tipo pelo conteúdo (assinatura), não pelo que o cliente declarou.
 * Só os tipos da lista positiva são reconhecidos; SVG, HTML e o resto retornam null.
 */
export function detectType(data: Buffer): AttachmentType | null {
  if (startsWith(data, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(data, [0x52, 0x49, 0x46, 0x46]) && startsWith(data, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(data, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return null;
}
