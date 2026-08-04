export function shouldForceLocalPreferenceStorage(
  isDesktop: boolean,
  remoteSyncConnected: boolean | null,
  storageMode: "local" | "cloud",
): boolean {
  return isDesktop && remoteSyncConnected === false && storageMode === "cloud";
}
