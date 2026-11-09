import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { cn } from "@/lib/utils";

/**
 * The bar over a tile grid while it is being edited: a hint or extra controls
 * on the left, then Reset, Add tiles (while the picker is closed) and Done.
 */
export function TileEditBar({
  children,
  onReset,
  onAdd,
  onDone,
  className,
}: {
  children?: ReactNode;
  onReset?: () => void;
  /** Leave out while the tile picker is open. */
  onAdd?: () => void;
  onDone: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-xs",
        className,
      )}
    >
      {children && (
        <div className="flex min-w-0 flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          {children}
        </div>
      )}
      <div className="ml-auto flex items-center gap-1">
        {onReset && (
          <Button size="xs" variant="ghost" className="gap-1" onClick={onReset}>
            <RotateCcw className="size-3" />
            {t("tileGrid.reset")}
          </Button>
        )}
        {onAdd && (
          <Button size="xs" variant="ghost" onClick={onAdd}>
            {t("tileGrid.addTiles")}
          </Button>
        )}
        <Button size="xs" onClick={onDone}>
          {t("tileGrid.done")}
        </Button>
      </div>
    </div>
  );
}
