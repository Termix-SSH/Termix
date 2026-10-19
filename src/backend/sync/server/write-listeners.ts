const writeListeners = new Set<() => void>();

/** Called after every successful write request, for a linked desktop's engine. */
export function onLocalWrite(listener: () => void): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

export function notifyLocalWrite(): void {
  for (const listener of writeListeners) listener();
}
