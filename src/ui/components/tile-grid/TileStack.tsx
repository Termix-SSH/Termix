import { Children, isValidElement, type ReactNode } from "react";
import { SeamlessTileContext } from "./context";
import { BottomEdge, EdgeOwned } from "./edge";

/**
 * Sections stacked edge to edge with a line under each, the column form of
 * the tile look. Cards inside drop their own border. The last line goes away
 * when the stack reaches the bottom of the screen.
 */
export function TileStack({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <SeamlessTileContext.Provider value={true}>
      <BottomEdge className={className} innerClassName="flex min-w-0 flex-col">
        <EdgeOwned>
          {Children.toArray(children).map((section, index) => (
            <div
              key={keyOf(section, index)}
              className="min-w-0 shrink-0 border-b border-border empty:hidden [&>[data-slot=toolbar-band]]:border-b-0"
            >
              {section}
            </div>
          ))}
        </EdgeOwned>
      </BottomEdge>
    </SeamlessTileContext.Provider>
  );
}

function keyOf(node: ReactNode, index: number): string | number {
  return isValidElement(node) && node.key !== null ? node.key : index;
}
