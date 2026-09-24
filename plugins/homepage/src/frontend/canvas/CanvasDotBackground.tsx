import { useEffect, useRef } from "react";

interface Props {
  pan: { x: number; y: number };
  zoom: number;
}

export function CanvasDotBackground({ pan, zoom }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    // Read dot color from CSS variable for theme support
    const dotColor =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--color-muted-foreground")
        .trim() || "#6b7280";

    // Effective grid spacing in screen pixels
    const spacing = 30 * zoom;

    // Skip rendering dots that are too close together or too far apart
    if (spacing < 8 || spacing > 200) return;

    // Offset so dots align with the canvas pan position
    const offsetX = ((pan.x % spacing) + spacing) % spacing;
    const offsetY = ((pan.y % spacing) + spacing) % spacing;

    const dotRadius = Math.max(0.8, Math.min(1.5, zoom * 1.2));

    ctx.fillStyle = dotColor;
    ctx.globalAlpha = 0.35;

    for (let x = offsetX; x < w; x += spacing) {
      for (let y = offsetY; y < h; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [pan, zoom]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}
