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

export type ToolbarDensity = "icon" | "labeled" | "expanded";

export const TOOLBAR_POSITION_STORAGE_KEY =
  "termix-terminal-toolbar-position-v2";
const TOOLBAR_MARGIN = 8;
const RECOVERY_SIZE = 44;

export function getDefaultToolbarPosition(): ToolbarPosition {
  return { x: 0, y: 0 };
}

export function sanitizeToolbarPosition(value: unknown): ToolbarPosition {
  if (!value || typeof value !== "object") return getDefaultToolbarPosition();
  const candidate = value as Partial<ToolbarPosition>;
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y)
    ? { x: Number(candidate.x), y: Number(candidate.y) }
    : getDefaultToolbarPosition();
}

export function readStoredToolbarPosition(): ToolbarPosition {
  if (typeof window === "undefined") return getDefaultToolbarPosition();
  try {
    return sanitizeToolbarPosition(
      JSON.parse(
        window.localStorage.getItem(TOOLBAR_POSITION_STORAGE_KEY) ?? "null",
      ),
    );
  } catch {
    return getDefaultToolbarPosition();
  }
}

export function persistToolbarPosition(position: ToolbarPosition): void {
  try {
    window.localStorage.setItem(
      TOOLBAR_POSITION_STORAGE_KEY,
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

export function getResponsiveToolbarDensity(
  selectedDensity: ToolbarDensity,
  currentDensity: ToolbarDensity,
  availableInlineSize: number,
  requiredInlineSize: number,
): ToolbarDensity {
  if (selectedDensity === "icon") return "icon";
  if (!Number.isFinite(availableInlineSize) || availableInlineSize <= 0)
    return currentDensity;
  if (!Number.isFinite(requiredInlineSize) || requiredInlineSize <= 0)
    return currentDensity;
  if (currentDensity === "icon")
    return availableInlineSize >= requiredInlineSize * 1.15
      ? selectedDensity
      : currentDensity;
  return availableInlineSize < requiredInlineSize * 1.1
    ? "icon"
    : selectedDensity;
}
