/**
 * Lets any part of the shell say it needs a framed plugin's live code, so
 * its background frame starts (and stays up) while the need lasts.
 */

type Acquire = () => () => void;

const sources = new Map<string, Acquire>();

export function setFrameDemand(
  pluginId: string,
  acquire: Acquire | null,
): void {
  if (acquire) sources.set(pluginId, acquire);
  else sources.delete(pluginId);
}

/** Starts the plugin's background frame; call the result when done. */
export function acquireFramedPlugin(pluginId: string): () => void {
  return sources.get(pluginId)?.() ?? (() => {});
}
