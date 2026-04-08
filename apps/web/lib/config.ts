export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000";

export function buildAttachmentUrl(
  downloadPath: string,
  accessToken: string | null | undefined,
) {
  const baseUrl = downloadPath.startsWith("http")
    ? downloadPath
    : `${API_URL}${downloadPath}`;

  if (!accessToken) {
    return baseUrl;
  }

  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}access_token=${encodeURIComponent(accessToken)}`;
}