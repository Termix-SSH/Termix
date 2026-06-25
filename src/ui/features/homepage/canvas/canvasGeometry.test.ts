import { describe, it, expect } from "vitest";
import {
  screenToCanvas,
  canvasToScreen,
  zoomAroundPoint,
} from "./canvasGeometry";

const PAN = { x: 100, y: 200 };
const ZOOM = 2;

describe("screenToCanvas", () => {
  it("inverts canvasToScreen", () => {
    const canvas = { x: 50, y: 75 };
    const screen = canvasToScreen(canvas.x, canvas.y, PAN, ZOOM);
    const back = screenToCanvas(screen.x, screen.y, PAN, ZOOM);
    expect(back.x).toBeCloseTo(canvas.x);
    expect(back.y).toBeCloseTo(canvas.y);
  });

  it("accounts for pan offset", () => {
    const result = screenToCanvas(100, 200, PAN, 1);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it("accounts for zoom", () => {
    const result = screenToCanvas(300, 400, PAN, ZOOM);
    expect(result.x).toBe((300 - 100) / 2);
    expect(result.y).toBe((400 - 200) / 2);
  });
});

describe("canvasToScreen", () => {
  it("maps origin with pan offset", () => {
    const result = canvasToScreen(0, 0, PAN, ZOOM);
    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
  });

  it("scales by zoom", () => {
    const result = canvasToScreen(10, 20, PAN, ZOOM);
    expect(result.x).toBe(120);
    expect(result.y).toBe(240);
  });
});

describe("zoomAroundPoint", () => {
  it("keeps the mouse point on the same canvas coordinate", () => {
    const mouseX = 400;
    const mouseY = 300;
    const pan = { x: 0, y: 0 };
    const oldZoom = 1;
    const newZoom = 2;

    const newPan = zoomAroundPoint(mouseX, mouseY, pan, oldZoom, newZoom);

    // Canvas coordinate under mouse before zoom
    const canvasBefore = screenToCanvas(mouseX, mouseY, pan, oldZoom);
    // Canvas coordinate under mouse after zoom with newPan
    const canvasAfter = screenToCanvas(mouseX, mouseY, newPan, newZoom);

    expect(canvasAfter.x).toBeCloseTo(canvasBefore.x);
    expect(canvasAfter.y).toBeCloseTo(canvasBefore.y);
  });

  it("returns correct pan for zoom-out", () => {
    const mouseX = 200;
    const mouseY = 150;
    const pan = { x: 50, y: 50 };
    const oldZoom = 2;
    const newZoom = 1;

    const newPan = zoomAroundPoint(mouseX, mouseY, pan, oldZoom, newZoom);
    const canvasBefore = screenToCanvas(mouseX, mouseY, pan, oldZoom);
    const canvasAfter = screenToCanvas(mouseX, mouseY, newPan, newZoom);

    expect(canvasAfter.x).toBeCloseTo(canvasBefore.x);
    expect(canvasAfter.y).toBeCloseTo(canvasBefore.y);
  });
});
