const DEFAULT_RDP_DPI = 96;
const MAX_DEVICE_PIXEL_RATIO = 3;

export interface GuacamoleDisplaySize {
  width: number;
  height: number;
  dpi?: number;
  pixelRatio: number;
}

export function getGuacamoleDisplaySize(
  cssWidth: number,
  cssHeight: number,
  protocol: string | undefined,
  devicePixelRatio: number,
  configuredDpi?: number,
): GuacamoleDisplaySize {
  const isRdp = protocol === "rdp";
  const pixelRatio = isRdp
    ? Math.min(
        MAX_DEVICE_PIXEL_RATIO,
        Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1),
      )
    : 1;

  const size = {
    width: Math.max(1, Math.round(cssWidth * pixelRatio)),
    height: Math.max(1, Math.round(cssHeight * pixelRatio)),
    pixelRatio,
  };

  if (!isRdp) return size;

  const baseDpi =
    configuredDpi && Number.isFinite(configuredDpi) && configuredDpi > 0
      ? configuredDpi
      : DEFAULT_RDP_DPI;
  return { ...size, dpi: Math.round(baseDpi * pixelRatio) };
}
