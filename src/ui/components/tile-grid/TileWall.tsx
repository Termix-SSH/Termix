import { Children, isValidElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { gridSizeStyle, type GridSize } from "@/components/panel-layout";
import { SeamlessTileContext } from "./context";
import { BottomEdge } from "./edge";

/**
 * A fixed grid of tiles edge to edge with one line between neighbours, for
 * stat strips and card lists. `size` is tiles per row ("auto" fits as many as
 * `minWidth` allows). Use TileGrid when people should move and resize tiles.
 */
export function TileWall({
  size = "auto",
  minWidth = 280,
  gridClassName,
  className,
  children,
}: {
  size?: GridSize;
  minWidth?: number;
  /** Column classes (like "grid-cols-1 md:grid-cols-3") in place of size. */
  gridClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  const tiles = Children.toArray(children);
  return (
    <SeamlessTileContext.Provider value={true}>
      {/* The grid sits a pixel wider so the right edge line is cut off. */}
      <BottomEdge className={className}>
        <div
          className={cn("-mr-px grid", gridClassName)}
          style={
            gridClassName ? undefined : gridSizeStyle(size, minWidth, "0px")
          }
        >
          {tiles.map((tile, index) => (
            <div
              key={keyOf(tile, index)}
              className="flex min-w-0 flex-col border-b border-r border-border *:flex-1"
            >
              {tile}
            </div>
          ))}
        </div>
      </BottomEdge>
    </SeamlessTileContext.Provider>
  );
}

function keyOf(node: ReactNode, index: number): string | number {
  return isValidElement(node) && node.key !== null ? node.key : index;
}
