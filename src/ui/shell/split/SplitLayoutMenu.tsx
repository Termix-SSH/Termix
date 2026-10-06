import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Columns2, LayoutPanelLeft, Rows2 } from "lucide-react";
import { Button } from "@/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
import type { LayoutNode } from "@/types/ui-types";
import {
  buildPreset,
  SPLIT_PRESETS,
  type SplitPresetId,
} from "./split-presets";
import { MAX_PANES, type PaneEdge } from "./split-tree";

function NodeThumb({ node }: { node: LayoutNode }) {
  if (node.kind === "pane") {
    return <div className="size-full border border-current" />;
  }
  return (
    <div
      className={`flex size-full gap-0.5 ${node.direction === "row" ? "flex-row" : "flex-col"}`}
    >
      {node.children.map((child, index) => (
        <div
          key={child.id}
          className="min-w-0 min-h-0"
          style={{ flex: `${node.sizes[index]} 1 0px` }}
        >
          <NodeThumb node={child} />
        </div>
      ))}
    </div>
  );
}

/** A small drawing of a preset's panes. */
export function PresetThumb({ id }: { id: SplitPresetId }) {
  const node = useMemo(() => buildPreset(id), [id]);
  return <NodeThumb node={node} />;
}

/**
 * The tab bar's split button: split the active tab right or down, or lay it
 * out as one of the presets.
 */
export function SplitLayoutMenu({
  activeIsSplit,
  canAddPane,
  onSplit,
  onPreset,
}: {
  activeIsSplit: boolean;
  canAddPane: boolean;
  onSplit: (edge: Extract<PaneEdge, "right" | "bottom">) => void;
  onPreset: (id: SplitPresetId) => void;
}) {
  const { t } = useTranslation();
  const fullTitle = canAddPane
    ? undefined
    : t("splitScreen.maxPanes", { count: MAX_PANES });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`h-full w-12.5 rounded-none ${activeIsSplit ? "text-accent-brand" : "text-muted-foreground hover:text-foreground"}`}
          title={t("splitScreen.title")}
          aria-label={t("splitScreen.title")}
        >
          <LayoutPanelLeft className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={1}
        className="w-64 border-t-0 [clip-path:inset(0px_-4px_-4px_-4px)] p-1"
      >
        <DropdownMenuItem
          disabled={!canAddPane}
          title={fullTitle}
          onSelect={() => onSplit("right")}
        >
          <Columns2 className="size-3.5" />
          {t("splitScreen.splitRight")}
          <DropdownMenuShortcut>Ctrl+Shift+\</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canAddPane}
          title={fullTitle}
          onSelect={() => onSplit("bottom")}
        >
          <Rows2 className="size-3.5" />
          {t("splitScreen.splitDown")}
          <DropdownMenuShortcut>Ctrl+Shift+-</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {activeIsSplit
            ? t("splitScreen.applyLayout")
            : t("splitScreen.layouts")}
        </DropdownMenuLabel>
        <div className="grid grid-cols-4 gap-1 p-1">
          {SPLIT_PRESETS.map((preset) => (
            <DropdownMenuItem
              key={preset.id}
              className="flex h-12 items-center justify-center p-1.5 text-muted-foreground focus:text-accent-brand"
              title={t(preset.titleKey)}
              aria-label={t(preset.titleKey)}
              onSelect={() => onPreset(preset.id)}
            >
              <div className="h-8 w-11">
                <PresetThumb id={preset.id} />
              </div>
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("splitScreen.shortcuts")}
        </DropdownMenuLabel>
        <div className="flex flex-col gap-1 px-2 pb-1.5 text-xs text-muted-foreground">
          <div className="flex items-center justify-between gap-2">
            <span>{t("splitScreen.shortcutNavigate")}</span>
            <kbd className="font-mono text-[10px]">Alt+Arrows</kbd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span>{t("splitScreen.zoom")}</span>
            <kbd className="font-mono text-[10px]">Ctrl+Shift+Enter</kbd>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
