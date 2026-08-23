export function getBasePath(): string {
  const runtime =
    document
      .querySelector<HTMLMetaElement>('meta[name="termix-base-path"]')
      ?.content.trim() ||
    ((window as unknown as Record<string, unknown>).__TERMIX_BASE_PATH__ as
      string | undefined);
  if (runtime) {
    return runtime.endsWith("/") ? runtime.slice(0, -1) : runtime;
  }
  const base = import.meta.env.BASE_URL || "/";
  if (base === "./" || base === "/") return "";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}
