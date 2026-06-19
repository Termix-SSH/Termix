import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, X, Plus, RotateCcw, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TerminalHandle } from "./terminal-types";

interface MobileTerminalKeyboardProps {
  terminalRef: React.RefObject<TerminalHandle | null>;
}

const BTN =
  "flex items-center justify-center h-8 px-2.5 min-w-[2.5rem] text-xs font-medium rounded border transition-colors select-none active:scale-95";

const BTN_NORMAL = "border-border bg-muted/50 text-foreground hover:bg-muted";
const BTN_ACTIVE =
  "border-accent-brand/60 bg-accent-brand/15 text-accent-brand";

const DEFAULT_QUICK_KEYS = [
  "/",
  "|",
  "~",
  "-",
  "_",
  "#",
  "\\",
  '"',
  "'",
  ";",
  ":",
  "!",
  "&",
];
const LS_KEY = "termix:mobileQuickKeys";

function loadQuickKeys(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string"))
        return parsed;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_QUICK_KEYS;
}

function saveQuickKeys(keys: string[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(keys));
  } catch {
    /* ignore */
  }
}

export function MobileTerminalKeyboard({
  terminalRef,
}: MobileTerminalKeyboardProps) {
  const { t } = useTranslation();
  const [shiftActive, setShiftActive] = useState(false);
  const [ctrlActive, setCtrlActive] = useState(false);
  const [quickKeys, setQuickKeys] = useState<string[]>(loadQuickKeys);
  const [editing, setEditing] = useState(false);
  const [newSymbol, setNewSymbol] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function send(seq: string) {
    terminalRef.current?.sendInput?.(seq);
  }

  function handleSpecialKey(baseSeq: string, shiftSeq?: string) {
    const seq = shiftActive && shiftSeq ? shiftSeq : baseSeq;
    send(seq);
    setShiftActive(false);
  }

  function handleCtrlKey(key: string) {
    const ctrlMap: Record<string, string> = {
      c: "\x03",
      d: "\x04",
      l: "\x0C",
      u: "\x15",
      z: "\x1A",
      a: "\x01",
    };
    const seq = ctrlMap[key.toLowerCase()];
    if (seq) send(seq);
    setCtrlActive(false);
  }

  function handleTab() {
    if (shiftActive) {
      send("\x1b[Z");
      setShiftActive(false);
    } else {
      send("\t");
    }
  }

  function updateQuickKeys(next: string[]) {
    setQuickKeys(next);
    saveQuickKeys(next);
  }

  function removeQuickKey(index: number) {
    updateQuickKeys(quickKeys.filter((_, i) => i !== index));
  }

  function addQuickKey() {
    const sym = newSymbol.trim();
    if (!sym || quickKeys.includes(sym)) {
      setNewSymbol("");
      return;
    }
    updateQuickKeys([...quickKeys, sym]);
    setNewSymbol("");
  }

  function resetDefaults() {
    updateQuickKeys(DEFAULT_QUICK_KEYS);
  }

  return (
    <div className="md:hidden flex flex-col bg-sidebar border-t border-border shrink-0">
      {/* Main toolbar row */}
      <div className="flex items-center gap-1 px-2 py-1.5 overflow-x-auto">
        {/* Sticky modifiers */}
        <button
          className={cn(BTN, shiftActive ? BTN_ACTIVE : BTN_NORMAL)}
          onPointerDown={(e) => {
            e.preventDefault();
            setShiftActive((v) => !v);
            setCtrlActive(false);
          }}
          title={t("mobileKeyboard.shift")}
        >
          {t("mobileKeyboard.shift")}
        </button>
        <button
          className={cn(BTN, ctrlActive ? BTN_ACTIVE : BTN_NORMAL)}
          onPointerDown={(e) => {
            e.preventDefault();
            setCtrlActive((v) => !v);
            setShiftActive(false);
          }}
          title={t("mobileKeyboard.ctrl")}
        >
          {t("mobileKeyboard.ctrl")}
        </button>

        <div className="w-px h-5 bg-border mx-0.5 shrink-0" />

        {/* Tab / Shift+Tab */}
        <button
          className={cn(
            BTN,
            BTN_NORMAL,
            shiftActive && "ring-1 ring-accent-brand/40",
          )}
          onPointerDown={(e) => {
            e.preventDefault();
            handleTab();
          }}
          title={
            shiftActive ? t("mobileKeyboard.shiftTab") : t("mobileKeyboard.tab")
          }
        >
          {shiftActive ? t("mobileKeyboard.shiftTab") : t("mobileKeyboard.tab")}
        </button>

        {/* Esc */}
        <button
          className={cn(BTN, BTN_NORMAL)}
          onPointerDown={(e) => {
            e.preventDefault();
            handleSpecialKey("\x1b");
          }}
          title={t("mobileKeyboard.esc")}
        >
          {t("mobileKeyboard.esc")}
        </button>

        {/* Arrow keys */}
        <div className="w-px h-5 bg-border mx-0.5 shrink-0" />
        <button
          className={cn(BTN, BTN_NORMAL)}
          onPointerDown={(e) => {
            e.preventDefault();
            send("\x1b[A");
          }}
          title={t("mobileKeyboard.arrowUp")}
        >
          {t("mobileKeyboard.arrowUp")}
        </button>
        <button
          className={cn(BTN, BTN_NORMAL)}
          onPointerDown={(e) => {
            e.preventDefault();
            send("\x1b[B");
          }}
          title={t("mobileKeyboard.arrowDown")}
        >
          {t("mobileKeyboard.arrowDown")}
        </button>
        <button
          className={cn(BTN, BTN_NORMAL)}
          onPointerDown={(e) => {
            e.preventDefault();
            send("\x1b[D");
          }}
          title={t("mobileKeyboard.arrowLeft")}
        >
          {t("mobileKeyboard.arrowLeft")}
        </button>
        <button
          className={cn(BTN, BTN_NORMAL)}
          onPointerDown={(e) => {
            e.preventDefault();
            send("\x1b[C");
          }}
          title={t("mobileKeyboard.arrowRight")}
        >
          {t("mobileKeyboard.arrowRight")}
        </button>

        {/* Ctrl combos row -- only visible when Ctrl is active */}
        {ctrlActive && (
          <>
            <div className="w-px h-5 bg-border mx-0.5 shrink-0" />
            {["c", "d", "l", "u", "z", "a"].map((k) => (
              <button
                key={k}
                className={cn(BTN, BTN_NORMAL)}
                onPointerDown={(e) => {
                  e.preventDefault();
                  handleCtrlKey(k);
                }}
                title={`Ctrl+${k.toUpperCase()}`}
              >
                ^{k.toUpperCase()}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Quick keys row */}
      <div className="flex items-center gap-1 px-2 pb-1.5 overflow-x-auto">
        {quickKeys.map((sym, i) =>
          editing ? (
            <div key={i} className="relative shrink-0">
              <button
                className={cn(BTN, BTN_NORMAL, "pr-5")}
                onPointerDown={(e) => e.preventDefault()}
              >
                {sym}
              </button>
              <button
                className="absolute -top-1 -right-1 size-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
                onPointerDown={(e) => {
                  e.preventDefault();
                  removeQuickKey(i);
                }}
                title={t("mobileKeyboard.removeSymbol")}
              >
                <X className="size-2.5" />
              </button>
            </div>
          ) : (
            <button
              key={i}
              className={cn(BTN, BTN_NORMAL, "shrink-0")}
              onPointerDown={(e) => {
                e.preventDefault();
                send(sym);
              }}
              title={sym}
            >
              {sym}
            </button>
          ),
        )}

        {editing && (
          <div className="flex items-center gap-1 shrink-0">
            <input
              ref={inputRef}
              className="h-8 w-14 px-2 text-xs rounded border border-border bg-muted/50 text-foreground focus:outline-none focus:ring-1 focus:ring-accent-brand/60"
              value={newSymbol}
              maxLength={4}
              placeholder={t("mobileKeyboard.quickKeyPlaceholder")}
              onChange={(e) => setNewSymbol(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addQuickKey();
              }}
            />
            <button
              className={cn(BTN, BTN_NORMAL)}
              onPointerDown={(e) => {
                e.preventDefault();
                addQuickKey();
              }}
              title={t("mobileKeyboard.addSymbol")}
            >
              <Plus className="size-3.5" />
            </button>
            <button
              className={cn(BTN, BTN_NORMAL)}
              onPointerDown={(e) => {
                e.preventDefault();
                resetDefaults();
              }}
              title={t("mobileKeyboard.resetDefaults")}
            >
              <RotateCcw className="size-3.5" />
            </button>
          </div>
        )}

        <div className="ml-auto shrink-0">
          <button
            className={cn(BTN, editing ? BTN_ACTIVE : BTN_NORMAL)}
            onPointerDown={(e) => {
              e.preventDefault();
              setEditing((v) => !v);
              setNewSymbol("");
            }}
            title={
              editing
                ? t("mobileKeyboard.doneEditing")
                : t("mobileKeyboard.editQuickKeys")
            }
          >
            {editing ? (
              <Check className="size-3.5" />
            ) : (
              <Pencil className="size-3.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
