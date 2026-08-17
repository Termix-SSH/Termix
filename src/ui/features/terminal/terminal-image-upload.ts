export type TerminalImageUploadSource = "file" | "clipboard";

export function buildImageUploadFormData(
  file: File,
  instanceId: string,
  source: TerminalImageUploadSource,
  clientUploadTimestamp = new Date().toISOString(),
): FormData {
  const form = new FormData();
  form.append("image", file);
  form.append("instanceId", instanceId);
  form.append("source", source);
  form.append("clientUploadTimestamp", clientUploadTimestamp);
  return form;
}
