/**
 * Where the docked assistant panel sits over a terminal. Same clamping rules
 * as the terminal's own toolbar, kept here so the panel owns its geometry.
 */

export interface ToolbarPosition {
  x: number;
  y: number;
}

export interface RectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

const AI_PANEL_POSITION_STORAGE_KEY = "termix-terminal-ai-panel-position";
const TOOLBAR_MARGIN = 8;
const RECOVERY_SIZE = 44;

function sanitizeToolbarPosition(value: unknown): ToolbarPosition {
  if (!value || typeof value !== "object") return { x: 0, y: 0 };
  const candidate = value as Partial<ToolbarPosition>;
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y)
    ? { x: Number(candidate.x), y: Number(candidate.y) }
    : { x: 0, y: 0 };
}

export function readStoredAiPanelPosition(): ToolbarPosition {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  try {
    return sanitizeToolbarPosition(
      JSON.parse(
        window.localStorage.getItem(AI_PANEL_POSITION_STORAGE_KEY) ?? "null",
      ),
    );
  } catch {
    return { x: 0, y: 0 };
  }
}

export function persistAiPanelPosition(position: ToolbarPosition): void {
  try {
    window.localStorage.setItem(
      AI_PANEL_POSITION_STORAGE_KEY,
      JSON.stringify(sanitizeToolbarPosition(position)),
    );
  } catch {
    // Storage may be unavailable in hardened browser contexts.
  }
}

export function clampToolbarPosition(
  position: ToolbarPosition,
  toolbarRect: RectLike,
  hostRect: RectLike,
  renderedPosition: ToolbarPosition = position,
): ToolbarPosition {
  if (
    !toolbarRect.width ||
    !toolbarRect.height ||
    !hostRect.width ||
    !hostRect.height
  )
    return sanitizeToolbarPosition(position);
  const left = hostRect.left + TOOLBAR_MARGIN;
  const right = hostRect.right - TOOLBAR_MARGIN;
  const top = hostRect.top + TOOLBAR_MARGIN;
  const bottom = hostRect.bottom - TOOLBAR_MARGIN;
  const baseLeft = toolbarRect.left - renderedPosition.x;
  const baseRight = toolbarRect.right - renderedPosition.x;
  const baseTop = toolbarRect.top - renderedPosition.y;
  const baseBottom = toolbarRect.bottom - renderedPosition.y;
  const clamp = (min: number, max: number, value: number) =>
    Math.min(max, Math.max(min, value));
  const xMin =
    toolbarRect.width <= right - left
      ? left - baseLeft
      : left + RECOVERY_SIZE - baseRight;
  const xMax = right - baseRight;
  const yMin =
    toolbarRect.height <= bottom - top
      ? top - baseTop
      : top + RECOVERY_SIZE - baseBottom;
  const yMax = bottom - baseBottom;
  return { x: clamp(xMin, xMax, position.x), y: clamp(yMin, yMax, position.y) };
}
