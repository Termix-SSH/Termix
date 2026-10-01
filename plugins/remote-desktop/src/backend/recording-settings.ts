/**
 * Merges Termix's recording bookkeeping into a host's guacd settings.
 *
 * Location and filename are not the host's to choose: recordings are indexed by
 * them for playback, and the backend refuses to read anything outside its
 * recordings directory. What a recording *contains* is a host-level decision, so
 * those flags are only defaulted, never overwritten.
 */
export function withRecordingSettings(
  guacConfig: Record<string, unknown>,
  recordingPath: string,
  recordingName: string,
): Record<string, unknown> {
  return {
    ...guacConfig,
    "recording-path": recordingPath,
    "recording-name": recordingName,
    "create-recording-path": true,
    "recording-exclude-output": guacConfig["recording-exclude-output"] ?? false,
    "recording-include-keys": guacConfig["recording-include-keys"] ?? true,
  };
}
