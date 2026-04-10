export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000";

export function buildAuthorizedAssetUrl(
  assetPath: string,
  accessToken: string | null | undefined,
) {
  const baseUrl = assetPath.startsWith("http")
    ? assetPath
    : `${API_URL}${assetPath}`;

  if (!accessToken) {
    return baseUrl;
  }

  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}access_token=${encodeURIComponent(accessToken)}`;
}

export const buildAttachmentUrl = buildAuthorizedAssetUrl;
export const buildAvatarUrl = buildAuthorizedAssetUrl;
