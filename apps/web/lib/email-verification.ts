const EMAIL_VERIFICATION_PREVIEW_URL_STORAGE_KEY = "emailVerificationPreviewUrl";

export function setStoredEmailVerificationPreviewUrl(previewUrl: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (previewUrl) {
    window.sessionStorage.setItem(
      EMAIL_VERIFICATION_PREVIEW_URL_STORAGE_KEY,
      previewUrl,
    );
    return;
  }

  window.sessionStorage.removeItem(EMAIL_VERIFICATION_PREVIEW_URL_STORAGE_KEY);
}

export function getStoredEmailVerificationPreviewUrl() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.sessionStorage.getItem(EMAIL_VERIFICATION_PREVIEW_URL_STORAGE_KEY);
}
