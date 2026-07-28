export const attachmentMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AttachmentMimeType = (typeof attachmentMimeTypes)[number];

export const attachmentAccept = attachmentMimeTypes.join(",");
export const maxAttachmentCount = 4;
export const maxAttachmentSourceBytes = 100 * 1024 * 1024;
export const maxAttachmentUploadBytes = 10 * 1024 * 1024;
export const maxAttachmentImageDimension = 4096;
export const maxExtractedAttachmentCharacters = 16_000;

export function isAttachmentMimeType(
  value: string,
): value is AttachmentMimeType {
  return attachmentMimeTypes.includes(value as AttachmentMimeType);
}
