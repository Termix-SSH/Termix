import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { Separator } from "@/components/separator";
import { Terminal } from "lucide-react";
import type { Tab } from "@/types/ui-types";

export function SshToolsPanel({
  terminalTabs,
  activeTabId,
}: {
  terminalTabs: Tab[];
  activeTabId: string;
}) {
  const { t } = useTranslation();
  const [keyRecording, setKeyRecording] = useState(false);
  const [rightClickPaste, setRightClickPaste] = useState(false);
  const [selectedTabIds, setSelectedTabIds] = useState<Set<string>>(
    () =>
      new Set(
        activeTabId && terminalTabs.some((t) => t.id === activeTabId)
          ? [activeTabId]
          : [],
      ),
  );

  function toggleTab(id: string) {
    setSelectedTabIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedTabIds(new Set(terminalTabs.map((t) => t.id)));
  }

  function deselectAll() {
    setSelectedTabIds(new Set());
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-widest">
          {t("newUi.sidebar.sshTools.keyRecordingTitle")}
        </span>

        {/* Terminal selector */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {t("newUi.sidebar.sshTools.recordToTerminals")}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={selectAll}
                className="text-[10px] text-accent-brand hover:text-accent-brand/70"
              >
                {t("newUi.sidebar.sshTools.selectAll")}
              </button>
              <button
                onClick={deselectAll}
                className="text-[10px] text-accent-brand hover:text-accent-brand/70"
              >
                {t("newUi.sidebar.sshTools.selectNone")}
              </button>
            </div>
          </div>

          {terminalTabs.length === 0 ? (
            <div className="flex items-center gap-1.5 px-2.5 py-2 border border-dashed border-border/60 text-muted-foreground/40">
              <Terminal className="size-3 shrink-0" />
              <span className="text-xs">
                {t("newUi.sidebar.sshTools.noTerminalTabsOpen")}
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {terminalTabs.map((tab) => {
                const selected = selectedTabIds.has(tab.id);
                return (
                  <button
                    key={tab.id}
                    onClick={() => toggleTab(tab.id)}
                    className={`flex items-center gap-2 px-2.5 py-1.5 border text-left transition-colors ${
                      selected
                        ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand"
                        : "border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40"
                    }`}
                  >
                    <div
                      className={`size-3 border-2 flex items-center justify-center shrink-0 transition-colors ${
                        selected
                          ? "border-accent-brand bg-accent-brand"
                          : "border-border/60"
                      }`}
                    >
                      {selected && <div className="size-1.5 bg-background" />}
                    </div>
                    <Terminal className="size-3 shrink-0 opacity-60" />
                    <span className="text-xs font-medium truncate flex-1">
                      {tab.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <Button
          variant="outline"
          disabled={selectedTabIds.size === 0}
          className={`w-full ${keyRecording ? "border-accent-brand/40 text-accent-brand bg-accent-brand/10 hover:bg-accent-brand/20 hover:text-accent-brand" : ""}`}
          onClick={() => setKeyRecording((o) => !o)}
        >
          {keyRecording
            ? `Stop Recording (${selectedTabIds.size})`
            : selectedTabIds.size === 0
              ? t("newUi.sidebar.sshTools.selectTerminalsAbove")
              : `Start Recording (${selectedTabIds.size})`}
        </Button>
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-widest">
          {t("newUi.sidebar.sshTools.settingsTitle")}
        </span>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground">
            {t("newUi.sidebar.sshTools.enableRightClickCopyPaste")}
          </span>
          <button
            onClick={() => setRightClickPaste((o) => !o)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center border-2 transition-colors ${
              rightClickPaste
                ? "bg-accent-brand border-accent-brand"
                : "bg-muted border-border"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-3 w-3 bg-background shadow-sm transition-transform ${rightClickPaste ? "translate-x-4" : "translate-x-0.5"}`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
