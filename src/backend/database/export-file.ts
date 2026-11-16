import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ExportFile {
  /** A folder made for this one export, removed with the file. */
  dir: string;
  path: string;
}

export function exportRoot(): string {
  return path.join(os.tmpdir(), "termix-exports");
}

/** Joins a name onto a folder and refuses anything that lands outside it. */
export function resolveInside(dir: string, name: string): string {
  const base = path.resolve(dir);
  const full = path.resolve(base, name);
  if (path.dirname(full) !== base) {
    throw new Error("Path leaves its folder");
  }
  return full;
}

/** Nothing from the user goes into the path, only a random name. */
export function createExportFile(root: string = exportRoot()): ExportFile {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const dir = fs.mkdtempSync(path.join(root, "export-"));
  return {
    dir,
    path: resolveInside(dir, `termix-export-${randomUUID()}.sqlite`),
  };
}

export function removeExportFile(file: ExportFile): void {
  fs.rm(file.dir, { recursive: true, force: true }, () => {});
}

/** The name the browser saves the download as. */
export function exportDownloadName(username: string, at = new Date()): string {
  const safe =
    String(username ?? "")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/\.{2,}/g, "_")
      .replace(/^[._-]+/, "")
      .slice(0, 64) || "user";
  const timestamp = at.toISOString().replace(/[:.]/g, "-");
  return `termix-export-${safe}-${timestamp}.sqlite`;
}
