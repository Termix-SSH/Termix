import { createContext, useContext } from "react";

/** True inside an edge to edge TileGrid, where the grid draws the lines. */
export const SeamlessTileContext = createContext(false);

export function useInSeamlessTile(): boolean {
  return useContext(SeamlessTileContext);
}
