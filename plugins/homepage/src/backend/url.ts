export function normalizeServiceLinkUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
}

export function isValidServiceLinkUrl(value: string): boolean {
  try {
    const parsed = new URL(normalizeServiceLinkUrl(value));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
