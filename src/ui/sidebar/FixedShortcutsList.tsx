import { useTranslation } from "react-i18next";
import { tabJumpHotkeyKeys } from "@/lib/tab-jump-hotkey";

/** Shortcuts the shell handles itself; they cannot be rebound. */
export function fixedShortcuts(): Array<{ keys: string[]; labelKey: string }> {
  return [
    { keys: ["Ctrl", "Shift", "\\"], labelKey: "splitRight" },
    { keys: ["Ctrl", "Shift", "-"], labelKey: "splitDown" },
    { keys: ["Ctrl", "Shift", "Enter"], labelKey: "zoomPane" },
    { keys: ["Alt", "↑↓←→"], labelKey: "navigatePane" },
    { keys: ["Ctrl", "Shift", "]"], labelKey: "nextTab" },
    { keys: ["Ctrl", "Shift", "["], labelKey: "previousTab" },
    { keys: tabJumpHotkeyKeys(), labelKey: "jumpTab" },
    { keys: ["Ctrl", "Shift", "E"], labelKey: "previousView" },
    { keys: ["Ctrl", "Shift", "F"], labelKey: "fullscreen" },
  ];
}

export function FixedShortcutsList() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted-foreground">
        {t("newUi.sidebar.keybindings.fixedHeading")}
      </span>
      {fixedShortcuts().map(({ keys, labelKey }) => (
        <div
          key={labelKey}
          className="flex items-center justify-between gap-2 border border-border/60 px-2.5 py-1.5"
        >
          <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">
            {t(`newUi.sidebar.keybindings.fixed.${labelKey}`)}
          </span>
          <div className="flex items-center gap-0.5 shrink-0">
            {keys.map((key, index) => (
              <kbd
                key={index}
                className="inline-flex items-center px-1 py-0.5 text-[10px] font-mono bg-muted border border-border/60 text-muted-foreground leading-none"
              >
                {key}
              </kbd>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
