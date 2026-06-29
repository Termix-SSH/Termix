import { GRID_SIZE } from "@/types/homepage-types";

export function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

export function snapToGridFloor(value: number): number {
  return Math.floor(value / GRID_SIZE) * GRID_SIZE;
}
