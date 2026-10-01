/**
 * Per-host Guacamole connection settings, as edited in the host editor and
 * forwarded to guacd. Field names are camelCase here and translated to the
 * hyphenated protocol parameters in toGuacamoleParams().
 */
export interface GuacamoleConfig {
  colorDepth?: number;
  width?: number;
  height?: number;
  dpi?: number;
  resizeMethod?: string;
  forceLossless?: boolean;
  disableAudio?: boolean;
  enableAudioInput?: boolean;
  enableWallpaper?: boolean;
  enableTheming?: boolean;
  enableFontSmoothing?: boolean;
  enableFullWindowDrag?: boolean;
  enableDesktopComposition?: boolean;
  enableMenuAnimations?: boolean;
  disableBitmapCaching?: boolean;
  disableOffscreenCaching?: boolean;
  disableGlyphCaching?: boolean;
  disableGfx?: boolean;
  enablePrinting?: boolean;
  printerName?: string;
  enableDrive?: boolean;
  driveName?: string;
  drivePath?: string;
  createDrivePath?: boolean;
  disableDownload?: boolean;
  disableUpload?: boolean;
  enableTouch?: boolean;
  clientName?: string;
  console?: boolean;
  initialProgram?: string;
  serverLayout?: string;
  timezone?: string;
  gatewayHostname?: string;
  gatewayPort?: number;
  gatewayUsername?: string;
  gatewayPassword?: string;
  gatewayDomain?: string;
  remoteApp?: string;
  remoteAppDir?: string;
  remoteAppArgs?: string;
  normalizeClipboard?: string;
  disableCopy?: boolean;
  disablePaste?: boolean;
  cursor?: string;
  swapRedBlue?: boolean;
  readOnly?: boolean;
  recordingPath?: string;
  recordingName?: string;
  createRecordingPath?: boolean;
  recordingExcludeOutput?: boolean;
  recordingExcludeMouse?: boolean;
  recordingIncludeKeys?: boolean;
  wolSendPacket?: boolean;
  wolMacAddr?: string;
  wolBroadcastAddr?: string;
  wolUdpPort?: number;
  wolWaitTime?: number;
}
