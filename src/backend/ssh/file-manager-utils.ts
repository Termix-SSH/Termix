export function isExecutableFile(
  permissions: string,
  fileName: string,
): boolean {
  const hasExecutePermission =
    permissions[3] === "x" || permissions[6] === "x" || permissions[9] === "x";

  const scriptExtensions = [
    ".sh",
    ".py",
    ".pl",
    ".rb",
    ".js",
    ".php",
    ".bash",
    ".zsh",
    ".fish",
  ];
  const hasScriptExtension = scriptExtensions.some((ext) =>
    fileName.toLowerCase().endsWith(ext),
  );

  const executableExtensions = [".bin", ".exe", ".out"];
  const hasExecutableExtension = executableExtensions.some((ext) =>
    fileName.toLowerCase().endsWith(ext),
  );

  const hasNoExtension = !fileName.includes(".") && hasExecutePermission;

  return (
    hasExecutePermission &&
    (hasScriptExtension || hasExecutableExtension || hasNoExtension)
  );
}

export function modeToPermissions(mode: number): string {
  const S_IFDIR = 0o040000;
  const S_IFLNK = 0o120000;
  const S_IFMT = 0o170000;

  const type = mode & S_IFMT;
  const prefix = type === S_IFDIR ? "d" : type === S_IFLNK ? "l" : "-";

  const perms = [
    mode & 0o400 ? "r" : "-",
    mode & 0o200 ? "w" : "-",
    mode & 0o100 ? "x" : "-",
    mode & 0o040 ? "r" : "-",
    mode & 0o020 ? "w" : "-",
    mode & 0o010 ? "x" : "-",
    mode & 0o004 ? "r" : "-",
    mode & 0o002 ? "w" : "-",
    mode & 0o001 ? "x" : "-",
  ].join("");

  return prefix + perms;
}

export function formatMtime(mtime: number): string {
  const date = new Date(mtime * 1000);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = months[date.getMonth()];
  const day = date.getDate().toString().padStart(2, " ");
  const now = new Date();
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

  if (date > sixMonthsAgo) {
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${month} ${day} ${hours}:${minutes}`;
  }
  return `${month} ${day}  ${date.getFullYear()}`;
}

export function getMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    txt: "text/plain",
    json: "application/json",
    js: "text/javascript",
    html: "text/html",
    css: "text/css",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    pdf: "application/pdf",
    zip: "application/zip",
    tar: "application/x-tar",
    gz: "application/gzip",
  };
  return mimeTypes[ext || ""] || "application/octet-stream";
}

export function detectBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;

  const sampleSize = Math.min(buffer.length, 8192);
  let nullBytes = 0;

  for (let i = 0; i < sampleSize; i++) {
    const byte = buffer[i];

    if (byte === 0) {
      nullBytes++;
    }

    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      if (++nullBytes > 1) return true;
    }
  }

  return nullBytes / sampleSize > 0.01;
}
