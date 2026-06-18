import { useState } from "react";
import { useTranslation } from "react-i18next";
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

export function MobileTerminalKeyboard({
  terminalRef,
}: MobileTerminalKeyboardProps) {
  const { t } = useTranslation();
  const [shiftActive, setShiftActive] = useState(false);
  const [ctrlActive, setCtrlActive] = useState(false);

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

  return (
    <div className="md:hidden flex items-center gap-1 px-2 py-1.5 bg-sidebar border-t border-border overflow-x-auto shrink-0">
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

      {/* Ctrl combos row — only visible when Ctrl is active */}
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
  );
}
