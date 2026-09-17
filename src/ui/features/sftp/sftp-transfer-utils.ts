export function normalizeRemoteDir(remotePath: string): string {
  const trimmed = remotePath.trim().replace(/\\/g, "/");
  if (!trimmed) return "/";
  const collapsed = trimmed.replace(/\/+/g, "/");
  const absolute = collapsed.startsWith("/") ? collapsed : `/${collapsed}`;
  if (absolute === "/") return "/";
  return absolute.replace(/\/+$/, "");
}

export function joinRemotePath(basePath: string, childPath: string): string {
  const base = normalizeRemoteDir(basePath);
  const child = childPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!child) return base;
  return base === "/" ? `/${child}` : `${base}/${child}`;
}

export function hasSameHostTransferConflict(
  sourcePaths: string[],
  destinationDir: string,
): boolean {
  const dest = normalizeRemoteDir(destinationDir);
  return sourcePaths.some((sourcePath) => {
    const source = normalizeRemoteDir(sourcePath);
    return dest === source || dest.startsWith(`${source}/`);
  });
}
