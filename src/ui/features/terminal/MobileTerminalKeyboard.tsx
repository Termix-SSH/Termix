import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
  X,
  Plus,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/sheet";
import type { TerminalHandle } from "./terminal-types";

interface MobileTerminalKeyboardProps {
  terminalRef: React.RefObject<TerminalHandle | null>;
}

const CTRL_MAP: Record<string, string> = {
  a: "\x01",
  c: "\x03",
  d: "\x04",
  k: "\x0B",
  l: "\x0C",
  r: "\x12",
  u: "\x15",
  w: "\x17",
  z: "\x1A",
};

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

// Shared button styles
const KEY_BASE =
  "flex items-center justify-center rounded border transition-colors select-none touch-none active:scale-95 shrink-0";
const KEY_NORMAL = "border-border bg-muted/50 text-foreground hover:bg-muted";
const KEY_ACTIVE =
  "border-accent-brand bg-accent-brand/20 text-accent-brand shadow-[0_0_0_1px_color-mix(in_oklab,var(--accent-brand)_30%,transparent)]";
const KEY_MD = "h-9 px-3 min-w-[2.75rem] text-xs font-medium";
const KEY_SM = "h-9 w-9";
const SEP = "w-px h-5 bg-border mx-0.5 shrink-0";

// --- QuickKeysSheet ---

interface QuickKeysSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quickKeys: string[];
  onUpdateKeys: (keys: string[]) => void;
}

function QuickKeysSheet({
  open,
  onOpenChange,
  quickKeys,
  onUpdateKeys,
}: QuickKeysSheetProps) {
  const { t } = useTranslation();
  const [newSymbol, setNewSymbol] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) setNewSymbol("");
  }, [open]);

  function addKey() {
    const sym = newSymbol.trim();
    if (!sym || quickKeys.includes(sym) || sym.length > 8) {
      setNewSymbol("");
      return;
    }
    onUpdateKeys([...quickKeys, sym]);
    setNewSymbol("");
    inputRef.current?.focus();
  }

  function removeKey(index: number) {
    onUpdateKeys(quickKeys.filter((_, i) => i !== index));
  }

  function resetDefaults() {
    onUpdateKeys(DEFAULT_QUICK_KEYS);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[70vh] flex flex-col border-border"
      >
        <SheetHeader className="flex-row items-start justify-between pr-8">
          <div>
            <SheetTitle>{t("mobileKeyboard.quickKeysTitle")}</SheetTitle>
            <SheetDescription>
              {t("mobileKeyboard.quickKeysDesc")}
            </SheetDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={resetDefaults}
          >
            <RotateCcw className="size-3 mr-1" />
            {t("mobileKeyboard.resetDefaults")}
          </Button>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          <div className="flex flex-wrap gap-2">
            {quickKeys.map((sym, i) => (
              <div
                key={i}
                className="flex items-center gap-1 h-8 pl-3 pr-1 rounded border border-border bg-muted/50 text-xs font-medium text-foreground"
              >
                <span className="font-mono">{sym}</span>
                <button
                  className="size-5 flex items-center justify-center rounded hover:bg-destructive hover:text-destructive-foreground transition-colors"
                  onClick={() => removeKey(i)}
                  title={t("mobileKeyboard.removeQuickKey")}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 px-4 py-2 border-t border-border">
          <Input
            ref={inputRef}
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addKey();
            }}
            maxLength={8}
            placeholder={t("mobileKeyboard.quickKeyPlaceholder")}
            className="h-9 text-xs font-mono"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9 shrink-0"
            onClick={addKey}
            disabled={!newSymbol.trim() || quickKeys.includes(newSymbol.trim())}
          >
            <Plus className="size-3.5 mr-1" />
            {t("mobileKeyboard.addQuickKey")}
          </Button>
        </div>

        <SheetFooter className="pt-0">
          <Button className="w-full" onClick={() => onOpenChange(false)}>
            {t("mobileKeyboard.done")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// --- CtrlPanel ---

interface CtrlPanelProps {
  onSend: (letter: string) => void;
}

function CtrlPanel({ onSend }: CtrlPanelProps) {
  const CTRL_KEYS = ["c", "d", "l", "u", "z", "a", "r", "w", "k"];

  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-muted/30 border-t border-border overflow-x-auto">
      {CTRL_KEYS.map((k) => (
        <button
          key={k}
          className={cn(KEY_BASE, KEY_NORMAL, KEY_MD, "font-mono")}
          onPointerDown={(e) => {
            e.preventDefault();
            onSend(k);
          }}
          title={`Ctrl+${k.toUpperCase()}`}
        >
          ^{k.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

// --- MobileTerminalKeyboard ---

export function MobileTerminalKeyboard({
  terminalRef,
}: MobileTerminalKeyboardProps) {
  const { t } = useTranslation();
  const [ctrlActive, setCtrlActive] = useState(false);
  const [shiftActive, setShiftActive] = useState(false);
  const [quickKeys, setQuickKeys] = useState<string[]>(loadQuickKeys);
  const [sheetOpen, setSheetOpen] = useState(false);

  function send(seq: string) {
    terminalRef.current?.sendInput?.(seq);
  }

  function toggleCtrl() {
    setCtrlActive((v) => !v);
    setShiftActive(false);
  }

  function toggleShift() {
    setShiftActive((v) => !v);
    setCtrlActive(false);
  }

  function sendArrow(normalSeq: string, appSeq: string, shiftSeq: string) {
    if (shiftActive) {
      send(shiftSeq);
      setShiftActive(false);
      return;
    }
    const appMode =
      terminalRef.current?.getApplicationCursorKeysMode?.() ?? false;
    send(appMode ? appSeq : normalSeq);
  }

  function handleTab() {
    send(shiftActive ? "\x1b[Z" : "\t");
    setShiftActive(false);
  }

  function handleCtrlKey(letter: string) {
    const seq = CTRL_MAP[letter];
    if (seq) send(seq);
    setCtrlActive(false);
  }

  function updateQuickKeys(next: string[]) {
    setQuickKeys(next);
    saveQuickKeys(next);
  }

  return (
    <div className="md:hidden flex flex-col bg-sidebar border-t border-border shrink-0">
      {/* Row 1 — special keys */}
      <div className="flex items-center gap-1 px-2 py-1.5 overflow-x-auto">
        {/* ESC */}
        <button
          className={cn(KEY_BASE, KEY_NORMAL, KEY_MD)}
          onPointerDown={(e) => {
            e.preventDefault();
            send("\x1b");
          }}
          title={t("mobileKeyboard.esc")}
        >
          {t("mobileKeyboard.esc")}
        </button>

        {/* Tab / back-tab */}
        <button
          className={cn(
            KEY_BASE,
            KEY_NORMAL,
            KEY_MD,
            shiftActive && "ring-1 ring-accent-brand/50",
          )}
          onPointerDown={(e) => {
            e.preventDefault();
            handleTab();
          }}
          title={shiftActive ? "Shift+Tab" : t("mobileKeyboard.tab")}
        >
          {shiftActive ? t("mobileKeyboard.backTab") : t("mobileKeyboard.tab")}
        </button>

        <div className={SEP} />

        {/* Ctrl */}
        <button
          className={cn(KEY_BASE, KEY_MD, ctrlActive ? KEY_ACTIVE : KEY_NORMAL)}
          onPointerDown={(e) => {
            e.preventDefault();
            toggleCtrl();
          }}
          title={t("mobileKeyboard.ctrl")}
        >
          {t("mobileKeyboard.ctrl")}
        </button>

        {/* Shift */}
        <button
          className={cn(
            KEY_BASE,
            KEY_MD,
            shiftActive ? KEY_ACTIVE : KEY_NORMAL,
          )}
          onPointerDown={(e) => {
            e.preventDefault();
            toggleShift();
          }}
          title={t("mobileKeyboard.shift")}
        >
          {t("mobileKeyboard.shift")}
        </button>

        <div className={SEP} />

        {/* Arrow keys */}
        <button
          className={cn(KEY_BASE, KEY_NORMAL, KEY_SM)}
          onPointerDown={(e) => {
            e.preventDefault();
            sendArrow("\x1b[A", "\x1bOA", "\x1b[1;2A");
          }}
          title={t("mobileKeyboard.arrowUp")}
        >
          <ChevronUp className="size-4" />
        </button>
        <button
          className={cn(KEY_BASE, KEY_NORMAL, KEY_SM)}
          onPointerDown={(e) => {
            e.preventDefault();
            sendArrow("\x1b[B", "\x1bOB", "\x1b[1;2B");
          }}
          title={t("mobileKeyboard.arrowDown")}
        >
          <ChevronDown className="size-4" />
        </button>
        <button
          className={cn(KEY_BASE, KEY_NORMAL, KEY_SM)}
          onPointerDown={(e) => {
            e.preventDefault();
            sendArrow("\x1b[D", "\x1bOD", "\x1b[1;2D");
          }}
          title={t("mobileKeyboard.arrowLeft")}
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          className={cn(KEY_BASE, KEY_NORMAL, KEY_SM)}
          onPointerDown={(e) => {
            e.preventDefault();
            sendArrow("\x1b[C", "\x1bOC", "\x1b[1;2C");
          }}
          title={t("mobileKeyboard.arrowRight")}
        >
          <ChevronRight className="size-4" />
        </button>

        <div className={SEP} />

        {/* Home / End */}
        <button
          className={cn(KEY_BASE, KEY_NORMAL, KEY_MD)}
          onPointerDown={(e) => {
            e.preventDefault();
            send("\x1b[H");
          }}
          title={t("mobileKeyboard.home")}
        >
          {t("mobileKeyboard.home")}
        </button>
        <button
          className={cn(KEY_BASE, KEY_NORMAL, KEY_MD)}
          onPointerDown={(e) => {
            e.preventDefault();
            send("\x1b[F");
          }}
          title={t("mobileKeyboard.end")}
        >
          {t("mobileKeyboard.end")}
        </button>

        <div className={SEP} />

        {/* PgUp / PgDn / Del */}
        <button
          className={cn(KEY_BASE, KEY_NORMAL, KEY_MD)}
          onPointerDown={(e) => {
            e.preventDefault();
            send("\x1b[5~");
          }}
          title={t("mobileKeyboard.pageUp")}
        >
          {t("mobileKeyboard.pageUp")}
        </button>
        <button
          className={cn(KEY_BASE, KEY_NORMAL, KEY_MD)}
          onPointerDown={(e) => {
            e.preventDefault();
            send("\x1b[6~");
          }}
          title={t("mobileKeyboard.pageDown")}
        >
          {t("mobileKeyboard.pageDown")}
        </button>
        <button
          className={cn(KEY_BASE, KEY_NORMAL, KEY_MD)}
          onPointerDown={(e) => {
            e.preventDefault();
            send("\x1b[3~");
          }}
          title={t("mobileKeyboard.delete")}
        >
          {t("mobileKeyboard.delete")}
        </button>
      </div>

      {/* Ctrl combos panel */}
      {ctrlActive && <CtrlPanel onSend={handleCtrlKey} />}

      {/* Row 2 — quick keys */}
      <div className="flex items-center gap-1 px-2 pb-1.5 overflow-x-auto">
        {quickKeys.map((sym, i) => (
          <button
            key={i}
            className={cn(KEY_BASE, KEY_NORMAL, KEY_MD, "font-mono")}
            onPointerDown={(e) => {
              e.preventDefault();
              send(sym);
            }}
            title={sym}
          >
            {sym}
          </button>
        ))}

        <div className="ml-auto shrink-0">
          <button
            className={cn(KEY_BASE, KEY_NORMAL, KEY_SM)}
            onPointerDown={(e) => {
              e.preventDefault();
              setSheetOpen(true);
            }}
            title={t("mobileKeyboard.editQuickKeys")}
          >
            <Pencil className="size-3.5" />
          </button>
        </div>
      </div>

      <QuickKeysSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        quickKeys={quickKeys}
        onUpdateKeys={updateQuickKeys}
      />
    </div>
  );
}
