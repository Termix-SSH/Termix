export function screenToCanvas(
  screenX: number,
  screenY: number,
  pan: { x: number; y: number },
  zoom: number,
): { x: number; y: number } {
  return {
    x: (screenX - pan.x) / zoom,
    y: (screenY - pan.y) / zoom,
  };
}

export function canvasToScreen(
  canvasX: number,
  canvasY: number,
  pan: { x: number; y: number },
  zoom: number,
): { x: number; y: number } {
  return {
    x: canvasX * zoom + pan.x,
    y: canvasY * zoom + pan.y,
  };
}

/** Pan value that keeps the canvas point (gridX, gridY) under (mouseX, mouseY) after zoom changes. */
export function zoomAroundPoint(
  mouseX: number,
  mouseY: number,
  pan: { x: number; y: number },
  oldZoom: number,
  newZoom: number,
): { x: number; y: number } {
  const gridX = (mouseX - pan.x) / oldZoom;
  const gridY = (mouseY - pan.y) / oldZoom;
  return {
    x: mouseX - gridX * newZoom,
    y: mouseY - gridY * newZoom,
  };
}
