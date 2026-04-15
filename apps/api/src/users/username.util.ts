const USERNAME_MAX_LENGTH = 24;

export function normalizeUsernameCandidate(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, USERNAME_MAX_LENGTH);
}

export function generateUsernameFromDisplayName(displayName: string, fallbackId?: string) {
  const normalized = normalizeUsernameCandidate(displayName);

  if (normalized) {
    return normalized;
  }

  if (fallbackId) {
    return `user_${fallbackId.slice(0, 8).toLowerCase()}`;
  }

  return `user_${Math.random().toString(36).slice(2, 10)}`;
}

export function isValidUsernameFormat(value: string) {
  return /^[a-z0-9_]{3,24}$/.test(value);
}
