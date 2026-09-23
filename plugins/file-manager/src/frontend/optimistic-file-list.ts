import type { FileItem } from "@/types/index";

export function childPath(parent: string, name: string): string {
  return parent === "/" ? `/${name}` : `${parent.replace(/\/$/, "")}/${name}`;
}

export function addOptimisticItem(
  files: FileItem[],
  parent: string,
  name: string,
  type: "file" | "directory",
  now = Date.now(),
): FileItem[] {
  const path = childPath(parent, name);
  if (files.some((file) => file.path === path)) return files;
  return [
    ...files,
    {
      name,
      path,
      type,
      size: type === "file" ? 0 : undefined,
      modified: new Date(now).toISOString(),
      modifiedTimestamp: now,
    },
  ];
}

export function removePaths(files: FileItem[], paths: Set<string>): FileItem[] {
  return files.filter((file) => !paths.has(file.path));
}

export function restoreItems(
  files: FileItem[],
  restored: FileItem[],
): FileItem[] {
  const existing = new Set(files.map((file) => file.path));
  return [...files, ...restored.filter((file) => !existing.has(file.path))];
}

export function renameOptimisticItem(
  files: FileItem[],
  originalPath: string,
  newName: string,
): FileItem[] {
  const slash = originalPath.lastIndexOf("/");
  const parent = slash <= 0 ? "/" : originalPath.slice(0, slash);
  return files.map((file) =>
    file.path === originalPath
      ? { ...file, name: newName, path: childPath(parent, newName) }
      : file,
  );
}
