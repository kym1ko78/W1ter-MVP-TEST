import { extname } from "node:path";

export const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;
export const ATTACHMENT_MAX_MB = Math.round(ATTACHMENT_MAX_BYTES / (1024 * 1024));

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "audio/webm",
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

const EXTENSION_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

const INLINE_MIME_PREFIXES = ["image/", "audio/", "video/", "text/"];
const INLINE_MIME_TYPES = new Set(["application/pdf"]);

export function getAttachmentValidationMessage() {
  return `Поддерживаются PNG, JPEG, WEBP, GIF, PDF, TXT, DOC/DOCX, XLS/XLSX, аудио (WEBM/OGG/MP3/M4A/WAV) и видео (MP4/WEBM/MOV).`;
}

export function resolveAttachmentMimeType(mimetype: string | undefined, fileName: string) {
  const compactMimeType = (mimetype ?? "").trim().toLowerCase().replace(/\s+/g, "");
  const primaryMimeType = compactMimeType.split(";")[0] ?? "";

  if (compactMimeType && ALLOWED_MIME_TYPES.has(compactMimeType)) {
    return compactMimeType;
  }

  if (primaryMimeType && ALLOWED_MIME_TYPES.has(primaryMimeType)) {
    return primaryMimeType;
  }

  const extension = extname(fileName).toLowerCase();
  const fallbackMimeType = EXTENSION_TO_MIME[extension];

  if (fallbackMimeType) {
    return fallbackMimeType;
  }

  return null;
}

export function getAttachmentStorageExtension(mimeType: string) {
  const normalizedMimeType = mimeType.split(";")[0] ?? mimeType;
  const entry = Object.entries(EXTENSION_TO_MIME).find(
    ([, mappedMimeType]) => mappedMimeType === mimeType || mappedMimeType === normalizedMimeType,
  );
  return entry?.[0] ?? "";
}

export function isInlineAttachmentMimeType(mimeType: string) {
  if (INLINE_MIME_TYPES.has(mimeType)) {
    return true;
  }

  return INLINE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}
