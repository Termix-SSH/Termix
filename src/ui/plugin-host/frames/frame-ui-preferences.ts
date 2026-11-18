/**
 * Lets a frame change its own plugin's interface preferences. The setter
 * comes from the shell's preferences context, through FrameStateSync.
 */

type Setter = (pluginId: string, key: string, value: unknown) => void;

let setter: Setter | null = null;

export function setUiPreferenceSetter(next: Setter | null): void {
  setter = next;
}

export function setUiPreferenceFromFrame(
  pluginId: string,
  key: string,
  value: unknown,
): void {
  if (key.length > 100) return;
  setter?.(pluginId, key, value);
}
