import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { Separator } from "@/components/separator";
import { Terminal } from "lucide-react";
import type { Tab } from "@/types/ui-types";
import { getCookie, setCookie } from "@/main-axios";

export function SshToolsPanel({
  terminalTabs,
  activeTabId,
}: {
  terminalTabs: Tab[];
  activeTabId: string;
}) {
  const { t } = useTranslation();
  const [keyRecording, setKeyRecording] = useState(false);
  const [rightClickPaste, setRightClickPaste] = useState(
    () => getCookie("rightClickCopyPaste") !== "false",
  );
  const [selectedTabIds, setSelectedTabIds] = useState<Set<string>>(
    () =>
      new Set(
        activeTabId && terminalTabs.some((t) => t.id === activeTabId)
          ? [activeTabId]
          : [],
      ),
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (keyRecording) inputRef.current?.focus();
  }, [keyRecording]);

  function toggleTab(id: string) {
    setSelectedTabIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedTabIds(new Set(terminalTabs.map((t) => t.id)));
  }

  function deselectAll() {
    setSelectedTabIds(new Set());
  }

  function broadcast(data: string) {
    for (const tabId of selectedTabIds) {
      const tab = terminalTabs.find((t) => t.id === tabId);
      tab?.terminalRef?.current?.sendInput?.(data);
    }
  }

  function broadcastArrow(normalSeq: string, appSeq: string) {
    for (const tabId of selectedTabIds) {
      const tab = terminalTabs.find((t) => t.id === tabId);
      const ref = tab?.terminalRef?.current;
      if (!ref) continue;
      const appMode = ref.getApplicationCursorKeysMode?.() ?? false;
      ref.sendInput?.(appMode ? appSeq : normalSeq);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    e.preventDefault();
    e.stopPropagation();

    const ctrl = e.ctrlKey;
    const { key } = e;

    if (ctrl) {
      const ctrlMap: Record<string, string> = {
        c: "\x03",
        d: "\x04",
        l: "\x0C",
        u: "\x15",
        k: "\x0B",
        a: "\x01",
        e: "\x05",
        w: "\x17",
        z: "\x1A",
        r: "\x12",
      };
      const seq = ctrlMap[key.toLowerCase()];
      if (seq) {
        broadcast(seq);
        return;
      }
    }

    if (key === "ArrowUp") {
      broadcastArrow("\x1B[A", "\x1BOA");
      return;
    }
    if (key === "ArrowDown") {
      broadcastArrow("\x1B[B", "\x1BOB");
      return;
    }
    if (key === "ArrowRight") {
      broadcastArrow("\x1B[C", "\x1BOC");
      return;
    }
    if (key === "ArrowLeft") {
      broadcastArrow("\x1B[D", "\x1BOD");
      return;
    }

    const specialMap: Record<string, string> = {
      Enter: "\r",
      Backspace: "\x7F",
      Delete: "\x1B[3~",
      Tab: "\t",
      Escape: "\x1B",
      Home: "\x1B[H",
      End: "\x1B[F",
      PageUp: "\x1B[5~",
      PageDown: "\x1B[6~",
      Insert: "\x1B[2~",
      F1: "\x1BOP",
      F2: "\x1BOQ",
      F3: "\x1BOR",
      F4: "\x1BOS",
      F5: "\x1B[15~",
      F6: "\x1B[17~",
      F7: "\x1B[18~",
      F8: "\x1B[19~",
      F9: "\x1B[20~",
      F10: "\x1B[21~",
      F11: "\x1B[23~",
      F12: "\x1B[24~",
    };

    const seq = specialMap[key];
    if (seq) {
      broadcast(seq);
      return;
    }

    if (!ctrl && !e.altKey && !e.metaKey && key.length === 1) {
      broadcast(key);
    }
  }

  function toggleRecording() {
    const next = !keyRecording;
    if (!next) {
      // clear the phantom text when stopping
      if (inputRef.current) inputRef.current.value = "";
    }
    setKeyRecording(next);
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
          onClick={toggleRecording}
        >
          {keyRecording
            ? `${t("newUi.sidebar.sshTools.stopRecording")} (${selectedTabIds.size})`
            : selectedTabIds.size === 0
              ? t("newUi.sidebar.sshTools.selectTerminalsAbove")
              : `${t("newUi.sidebar.sshTools.startRecording")} (${selectedTabIds.size})`}
        </Button>

        {keyRecording && (
          <input
            ref={inputRef}
            readOnly
            onKeyDown={handleKeyDown}
            placeholder={t("newUi.sidebar.sshTools.broadcastInputPlaceholder")}
            className="w-full px-2.5 py-2 text-xs bg-background border border-accent-brand/40 text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-accent-brand/70 caret-transparent"
          />
        )}
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
            onClick={() => {
              const next = !rightClickPaste;
              setRightClickPaste(next);
              setCookie("rightClickCopyPaste", next ? "true" : "false");
            }}
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
