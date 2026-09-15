export const MIN_GUACAMOLE_ZOOM = 0.5;
export const MAX_GUACAMOLE_ZOOM = 4;
export const GUACAMOLE_ZOOM_STEP = 0.25;

export function clampGuacamoleZoom(zoom: number): number {
  return Math.min(MAX_GUACAMOLE_ZOOM, Math.max(MIN_GUACAMOLE_ZOOM, zoom));
}

export function stepGuacamoleZoom(zoom: number, direction: -1 | 1): number {
  return clampGuacamoleZoom(zoom + direction * GUACAMOLE_ZOOM_STEP);
}
