export type FileDropDisposition = "ignore" | "reject" | "upload";

export function hasDraggedFiles(types: readonly string[]): boolean {
  return types.includes("Files");
}

export function getFileDropDisposition(
  types: readonly string[],
  fileCount: number,
  canUpload: boolean,
): FileDropDisposition {
  if (!hasDraggedFiles(types) || fileCount === 0) return "ignore";
  return canUpload ? "upload" : "reject";
}
