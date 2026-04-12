function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function normalizeLoopbackUrl(rawUrl: string) {
  if (typeof window === "undefined") {
    return rawUrl;
  }

  try {
    const parsedUrl = new URL(rawUrl);
    const currentHostname = window.location.hostname;

    if (!isLoopbackHost(parsedUrl.hostname) || !isLoopbackHost(currentHostname)) {
      return rawUrl;
    }

    if (parsedUrl.hostname === currentHostname) {
      return rawUrl;
    }

    parsedUrl.hostname = currentHostname;
    return parsedUrl.toString().replace(/\/$/, "");
  } catch {
    return rawUrl;
  }
}

export const API_URL = normalizeLoopbackUrl(
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
);

export const SOCKET_URL = normalizeLoopbackUrl(
  process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000",
);

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
