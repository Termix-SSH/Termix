/**
 * Content-Disposition for a download whose name may hold user data. The plain
 * filename keeps only safe ASCII; filename* carries the real name encoded
 * (RFC 6266 and RFC 5987), so quotes, slashes and line breaks can't break out.
 */
export function attachmentHeader(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, "_");
  const ascii = cleaned.replace(/[^\x20-\x7e]/g, "_").trim() || "download";
  const encoded = encodeURIComponent(cleaned).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
