export type TransferPlatform = "windows" | "unix";

/** OpenSSH SFTP on Windows commonly uses `/C:/...` or `C:/...` style paths. */
export function isWindowsSftpPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return /^[A-Za-z]:\//.test(normalized) || /^\/[A-Za-z]:\//.test(normalized);
}

export function inferPlatformFromPath(path: string): TransferPlatform | null {
  if (isWindowsSftpPath(path)) return "windows";
  if (path.startsWith("/") && !/^\/[A-Za-z]:/.test(path.replace(/\\/g, "/"))) {
    return "unix";
  }
  return null;
}

export function normalizeSftpPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return path.startsWith("/") ? "/" : ".";
  return normalized.replace(/([^:])\/+/g, "$1/");
}

export function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = normalized.lastIndexOf("/");
  if (idx < 0) return normalized;
  return normalized.substring(idx + 1) || normalized;
}

export function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return normalized;

  const idx = normalized.lastIndexOf("/");
  if (idx < 0) return normalized;

  const parent = normalized.substring(0, idx);
  if (!parent) return "/";
  if (/^\/[A-Za-z]:$/.test(parent) || /^[A-Za-z]:$/.test(parent)) {
    return parent;
  }
  return parent || "/";
}

export function joinPath(base: string, ...parts: string[]): string {
  let result = base.replace(/\\/g, "/");
  for (const part of parts) {
    if (!part) continue;
    const segment = part.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!segment) continue;
    if (result.endsWith("/")) {
      result += segment;
    } else {
      result = `${result}/${segment}`;
    }
  }
  return normalizeSftpPath(result);
}

export interface PathSegments {
  /** Drive root prefix, e.g. `/C:` or `C:`; empty for Unix absolute paths. */
  root: string;
  /** Path segments below the root (may be empty). */
  segments: string[];
}

export function splitPathSegments(path: string): PathSegments {
  const normalized = normalizeSftpPath(path);

  const posixDrive = normalized.match(/^(\/[A-Za-z]:)(?:\/(.*))?$/);
  if (posixDrive) {
    return {
      root: posixDrive[1],
      segments: (posixDrive[2] ?? "").split("/").filter(Boolean),
    };
  }

  const drive = normalized.match(/^([A-Za-z]:)(?:\/(.*))?$/);
  if (drive) {
    return {
      root: drive[1],
      segments: (drive[2] ?? "").split("/").filter(Boolean),
    };
  }

  if (normalized.startsWith("/")) {
    return {
      root: "/",
      segments: normalized.split("/").filter(Boolean),
    };
  }

  return {
    root: "",
    segments: normalized.split("/").filter(Boolean),
  };
}

export function buildPathFromSegments(
  root: string,
  segments: string[],
  count: number,
): string {
  const slice = segments.slice(0, count);
  if (/^\/[A-Za-z]:$/.test(root)) {
    return slice.length ? `${root}/${slice.join("/")}` : root;
  }
  if (/^[A-Za-z]:$/.test(root)) {
    return slice.length ? `${root}/${slice.join("/")}` : root;
  }
  if (root === "/") {
    return slice.length ? `/${slice.join("/")}` : "/";
  }
  if (root === "") {
    return slice.join("/");
  }
  return slice.length ? `${root}/${slice.join("/")}` : root;
}

export function pathsOverlap(source: string, dest: string): boolean {
  const norm = (p: string) => {
    const n = normalizeSftpPath(p).toLowerCase();
    return n || (isWindowsSftpPath(p) ? p : "/");
  };
  const s = norm(source);
  const d = norm(dest);
  const sep = "/";
  return s === d || s.startsWith(`${d}${sep}`) || d.startsWith(`${s}${sep}`);
}

export function getWorkingDir(paths: string[]): string {
  if (paths.length === 0) return "/";
  const parents = paths.map((p) => dirname(p));
  const first = parents[0];
  if (parents.every((p) => p === first)) {
    return first;
  }
  return first;
}

/** Convert an SFTP path to a local filesystem path when Termix runs on the dest host. */
export function sftpPathToLocalPath(sftpPath: string): string {
  const normalized = sftpPath.replace(/\\/g, "/");
  if (/^\/[A-Za-z]:\//.test(normalized)) {
    return normalized.slice(1).replace(/\//g, "\\");
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return normalized.replace(/\//g, "\\");
  }
  return sftpPath;
}
