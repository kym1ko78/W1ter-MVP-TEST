import type { ChatAttachment } from "../types/api";

export const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;
export const ATTACHMENT_MAX_MB = Math.round(ATTACHMENT_MAX_BYTES / (1024 * 1024));

const ATTACHMENT_ALLOWED_MIME_TYPES = new Set([
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

export const ATTACHMENT_ACCEPT = [
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
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  ".txt",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".mp3",
  ".m4a",
  ".wav",
  ".ogg",
  ".webm",
  ".mp4",
  ".mov",
].join(",");

export type AttachmentKind =
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "text"
  | "document"
  | "file";

type AttachmentValidationResult =
  | {
      isValid: true;
      mimeType: string;
    }
  | {
      isValid: false;
      error: string;
    };

function normalizeMimeType(mimeType: string | undefined) {
  return (mimeType ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

function extensionFromFileName(fileName: string) {
  const normalized = fileName.trim().toLowerCase();
  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex <= 0) {
    return "";
  }

  return normalized.slice(dotIndex);
}

export function getAllowedAttachmentMessage() {
  return "Поддерживаются PNG, JPEG, WEBP, GIF, PDF, TXT, DOC/DOCX, XLS/XLSX, аудио (WEBM/OGG/MP3/M4A/WAV) и видео (MP4/WEBM/MOV).";
}

export function resolveAttachmentMimeType(input: { type?: string; name: string }) {
  const compactMimeType = normalizeMimeType(input.type);
  const primaryMimeType = compactMimeType.split(";")[0] ?? "";

  if (compactMimeType && ATTACHMENT_ALLOWED_MIME_TYPES.has(compactMimeType)) {
    return compactMimeType;
  }

  if (primaryMimeType && ATTACHMENT_ALLOWED_MIME_TYPES.has(primaryMimeType)) {
    return primaryMimeType;
  }

  const extension = extensionFromFileName(input.name);
  return EXTENSION_TO_MIME[extension] ?? null;
}

export function validateAttachmentFile(file: File): AttachmentValidationResult {
  const resolvedMimeType = resolveAttachmentMimeType(file);

  if (!resolvedMimeType) {
    return {
      isValid: false,
      error: getAllowedAttachmentMessage(),
    };
  }

  if (file.size > ATTACHMENT_MAX_BYTES) {
    return {
      isValid: false,
      error: `Размер файла не должен превышать ${ATTACHMENT_MAX_MB} MB.`,
    };
  }

  return {
    isValid: true,
    mimeType: resolvedMimeType,
  };
}

export function getAttachmentKind(attachment: Pick<ChatAttachment, "mimeType" | "isImage" | "originalName">): AttachmentKind {
  const resolvedMimeType =
    resolveAttachmentMimeType({
      type: attachment.mimeType,
      name: attachment.originalName,
    }) ?? attachment.mimeType;

  if (attachment.isImage || resolvedMimeType.startsWith("image/")) {
    return "image";
  }

  if (resolvedMimeType.startsWith("audio/")) {
    return "audio";
  }

  if (resolvedMimeType.startsWith("video/")) {
    return "video";
  }

  if (resolvedMimeType === "application/pdf") {
    return "pdf";
  }

  if (resolvedMimeType.startsWith("text/")) {
    return "text";
  }

  if (
    resolvedMimeType === "application/msword" ||
    resolvedMimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    resolvedMimeType === "application/vnd.ms-excel" ||
    resolvedMimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return "document";
  }

  return "file";
}

export function getAttachmentTypeLabel(attachment: Pick<ChatAttachment, "mimeType" | "isImage" | "originalName">) {
  const kind = getAttachmentKind(attachment);

  switch (kind) {
    case "image":
      return "Изображение";
    case "audio":
      return "Аудио";
    case "video":
      return "Видео";
    case "pdf":
      return "PDF";
    case "text":
      return "TXT";
    case "document":
      return "Документ";
    default:
      return "Файл";
  }
}
