import type { ReactNode } from "react";
import { SeamlessTileContext } from "./context";
import { BottomEdge, EdgeOwned } from "./edge";

/**
 * A column of cards that can sit at any depth, like a settings page built
 * from several panels. Cards drop their box and the outermost ones draw a
 * line under themselves. Use TileStack when the sections are direct children.
 */
/** The line under each card in a column, drawn by the column. */
export const TILE_CARD_LINES =
  "[&_[data-tile-card]]:border-x-0 [&_[data-tile-card]]:border-t-0 [&_[data-tile-card]]:border-b [&_[data-tile-card]]:border-border [&_[data-tile-card]_[data-tile-card]]:border-b-0";

export function TileColumn({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <SeamlessTileContext.Provider value={true}>
      <BottomEdge
        className={className}
        innerClassName={`flex min-w-0 flex-col ${TILE_CARD_LINES}`}
      >
        <EdgeOwned>{children}</EdgeOwned>
      </BottomEdge>
    </SeamlessTileContext.Provider>
  );
}
