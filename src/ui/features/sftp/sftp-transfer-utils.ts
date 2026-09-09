export interface LocalUploadFile {
  path: string;
  name: string;
  relativePath: string;
  size: number;
}

export interface LocalUploadTarget extends LocalUploadFile {
  remoteDir: string;
  fileName: string;
  remotePath: string;
}

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

export function splitRelativePath(relativePath: string): {
  dir: string;
  fileName: string;
} {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  const fileName = parts.pop() || "";
  return {
    dir: parts.join("/"),
    fileName,
  };
}

export function buildLocalUploadTargets(
  files: LocalUploadFile[],
  destinationDir: string,
): LocalUploadTarget[] {
  const dest = normalizeRemoteDir(destinationDir);
  return files.map((file) => {
    const { dir, fileName } = splitRelativePath(file.relativePath || file.name);
    const remoteDir = dir ? joinRemotePath(dest, dir) : dest;
    return {
      ...file,
      remoteDir,
      fileName: fileName || file.name,
      remotePath: joinRemotePath(remoteDir, fileName || file.name),
    };
  });
}

export function getRequiredRemoteDirectories(
  targets: LocalUploadTarget[],
): string[] {
  const seen = new Set<string>();
  const dirs: string[] = [];

  for (const target of targets) {
    const dir = normalizeRemoteDir(target.remoteDir);
    if (dir === "/" || seen.has(dir)) continue;
    seen.add(dir);
    dirs.push(dir);
  }

  return dirs.sort((a, b) => a.split("/").length - b.split("/").length);
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
