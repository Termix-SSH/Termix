import { useState, useRef, useEffect, useSyncExternalStore } from "react";
import { KeyRound, Terminal } from "lucide-react";
import { toast } from "sonner";
import { Button, Separator } from "@termix/plugin-sdk/ui";
import {
  getClientPreference,
  getHostPassword,
  setClientPreference,
  useTranslation,
  type PanelProps,
} from "@termix/plugin-sdk/frontend";
import {
  getSessionHandle,
  sessionsSnapshot,
  subscribeSessions,
} from "../session-registry";

/**
 * SSH Tools: type into several open terminals at once, fill their saved
 * passwords, and the terminal's clipboard preferences.
 */
export function SshToolsPanel({ targetTab }: PanelProps) {
  const { t } = useTranslation();
  const terminalTabs = useSyncExternalStore(
    subscribeSessions,
    sessionsSnapshot,
  );
  const activeTabId = targetTab?.id ?? "";
  const [keyRecording, setKeyRecording] = useState(false);
  const [rightClickPaste, setRightClickPaste] = useState(
    () => getClientPreference("rightClickCopyPaste") !== "false",
  );
  const [copyOnSelect, setCopyOnSelect] = useState(
    () => getClientPreference("copyOnSelect") === "true",
  );
  const [selectedTabIds, setSelectedTabIds] = useState<Set<string>>(
    () =>
      new Set(
        activeTabId && terminalTabs.some((tab) => tab.id === activeTabId)
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
    setSelectedTabIds(new Set(terminalTabs.map((tab) => tab.id)));
  }

  function deselectAll() {
    setSelectedTabIds(new Set());
  }

  function broadcast(data: string) {
    for (const tabId of selectedTabIds) {
      getSessionHandle(tabId)?.sendInput(data);
    }
  }

  async function fillPassword() {
    let filled = 0;
    let missing = 0;

    for (const tabId of selectedTabIds) {
      const tab = terminalTabs.find((session) => session.id === tabId);
      const hostId = tab?.hostId ?? null;
      const ref = getSessionHandle(tabId);
      if (!hostId || !ref) {
        missing++;
        continue;
      }

      const password = await getHostPassword(hostId, "password");
      if (!password) {
        missing++;
        continue;
      }

      ref.sendInput(password + "\r");
      filled++;
    }

    if (filled > 0) {
      toast.success(t("sshTools.fillPasswordSuccess", { count: filled }));
    }
    if (missing > 0) {
      toast.error(t("sshTools.fillPasswordMissing", { count: missing }));
    }
  }

  function broadcastArrow(normalSeq: string, appSeq: string) {
    for (const tabId of selectedTabIds) {
      const ref = getSessionHandle(tabId);
      if (!ref) continue;
      const appMode = ref.getApplicationCursorKeysMode?.() ?? false;
      ref.sendInput(appMode ? appSeq : normalSeq);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    e.stopPropagation();
    const text = e.clipboardData.getData("text");
    if (text) broadcast(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const ctrl = e.ctrlKey;
    const { key } = e;

    // Let Ctrl/Cmd+V fall through so the browser fires a paste event
    // instead of being swallowed by the preventDefault() below.
    if ((ctrl || e.metaKey) && key.toLowerCase() === "v") {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

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
          {t("sshTools.keyRecordingTitle")}
        </span>

        {/* Terminal selector */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {t("sshTools.recordToTerminals")}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={selectAll}
                className="text-[10px] text-accent-brand hover:text-accent-brand/70"
              >
                {t("sshTools.selectAll")}
              </button>
              <button
                onClick={deselectAll}
                className="text-[10px] text-accent-brand hover:text-accent-brand/70"
              >
                {t("sshTools.selectNone")}
              </button>
            </div>
          </div>

          {terminalTabs.length === 0 ? (
            <div className="flex items-center gap-1.5 px-2.5 py-2 border border-dashed border-border/60 text-muted-foreground/40">
              <Terminal className="size-3 shrink-0" />
              <span className="text-xs">
                {t("sshTools.noTerminalTabsOpen")}
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
                      {tab.label || tab.hostName || tab.ip}
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
            ? `${t("sshTools.stopRecording")} (${selectedTabIds.size})`
            : selectedTabIds.size === 0
              ? t("sshTools.selectTerminalsAbove")
              : `${t("sshTools.startRecording")} (${selectedTabIds.size})`}
        </Button>

        {keyRecording && (
          <input
            ref={inputRef}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onChange={(e) => {
              // Keystrokes are broadcast directly via handleKeyDown; the
              // field itself must stay empty. This also catches paste
              // insertion on browsers that fire "input" before we can
              // intercept it in onPaste.
              e.target.value = "";
            }}
            placeholder={t("sshTools.broadcastInputPlaceholder")}
            className="w-full px-2.5 py-2 text-xs bg-background border border-accent-brand/40 text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-accent-brand/70 caret-transparent"
          />
        )}

        <Button
          variant="outline"
          disabled={selectedTabIds.size === 0}
          className="w-full"
          onClick={() => {
            void fillPassword();
          }}
        >
          <KeyRound className="size-3.5 mr-2" />
          {selectedTabIds.size === 0
            ? t("sshTools.selectTerminalsAbove")
            : `${t("sshTools.fillPassword")} (${selectedTabIds.size})`}
        </Button>
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-widest">
          {t("sshTools.settingsTitle")}
        </span>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground">
            {t("sshTools.enableRightClickCopyPaste")}
          </span>
          <button
            onClick={() => {
              const next = !rightClickPaste;
              setRightClickPaste(next);
              setClientPreference(
                "rightClickCopyPaste",
                next ? "true" : "false",
              );
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
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground">
            {t("sshTools.copyOnSelect")}
          </span>
          <button
            onClick={() => {
              const next = !copyOnSelect;
              setCopyOnSelect(next);
              setClientPreference("copyOnSelect", next ? "true" : "false");
            }}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center border-2 transition-colors ${
              copyOnSelect
                ? "bg-accent-brand border-accent-brand"
                : "bg-muted border-border"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-3 w-3 bg-background shadow-sm transition-transform ${copyOnSelect ? "translate-x-4" : "translate-x-0.5"}`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
