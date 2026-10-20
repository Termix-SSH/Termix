/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { TabHandle } from "@termix-ssh/plugin-sdk/frontend";
import {
  dispatchCtrlW,
  createCommandPaletteShortcutMatcher,
  isShiftKey,
} from "@/lib/app-keyboard-shortcuts";
import { getUserPreferences } from "@/main-axios";
import { parseCustomKeybindings } from "@/api/open-tabs-api";
import { findMatchingKeybinding } from "@/lib/keybinding-match";
import type {
  CustomKeybinding,
  KeybindingActionType,
} from "@/types/keybindings";
import {
  GLOBAL_KEYBINDING_EVENT,
  getKeybindingAction,
  runKeybindingAction,
} from "@/shell/keybinding-registry";
import { globalShortcutHandler } from "@/lib/global-shortcut-handler";
import { getPaneNavDirection } from "@/lib/pane-nav-hotkey";
import { getTabJumpDigit } from "@/lib/tab-jump-hotkey";
import type { TabsState } from "./use-tabs";
import type { SplitActions } from "./use-split";
import type { ShellPalette, ShellRegions } from "./types";

/** Every shell-wide shortcut: custom bindings, palette, panes and tabs. */
export function useShellKeybindings({
  tabsState,
  regions,
  palette,
  splitActionsRef,
  toggleFullscreen,
}: {
  tabsState: TabsState;
  regions: ShellRegions;
  palette: ShellPalette;
  splitActionsRef: MutableRefObject<SplitActions | null>;
  toggleFullscreen: () => void;
}) {
  const { tabsRef, activeTabIdRef, setActiveTabId, closeActiveTabRef } =
    tabsState;
  const globalKeybindingsRef = useRef<CustomKeybinding[]>([]);
  const toggleFullscreenRef = useRef(toggleFullscreen);
  toggleFullscreenRef.current = toggleFullscreen;

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getUserPreferences()
        .then((prefs) => {
          if (cancelled) return;
          globalKeybindingsRef.current = parseCustomKeybindings(
            prefs.customKeybindings,
          ).filter((binding) => binding.enabled);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("customKeybindingsChanged", load);
    return () => {
      cancelled = true;
      window.removeEventListener("customKeybindingsChanged", load);
    };
  }, []);

  useEffect(() => {
    const runAction = (type: KeybindingActionType) => {
      if (type === "openCommandPalette") {
        palette.setOpen(true);
        return;
      }
      if (type === "reconnectSession") {
        const tabId = tabsState.focusedSessionTabId();
        if (!tabId) return;
        const termRef = tabsState.terminalRefs.current.get(tabId);
        (termRef?.current as TabHandle | null)?.reconnect?.();
        return;
      }
      const currentTabs = tabsRef.current.filter(
        (tab) => !tab.parentSplitTabId,
      );
      if (currentTabs.length < 2) return;
      const index = currentTabs.findIndex(
        (tab) => tab.id === activeTabIdRef.current,
      );
      const offset = type === "nextTab" ? 1 : -1;
      const next = (index + offset + currentTabs.length) % currentTabs.length;
      setActiveTabId(currentTabs[next].id);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-keybinding-recorder]")
      )
        return;
      // Only actions that run anywhere; a terminal's own are its to handle.
      const binding = findMatchingKeybinding(
        event,
        globalKeybindingsRef.current.filter(
          (entry) => getKeybindingAction(entry.action.type)?.scope === "global",
        ),
      );
      if (!binding) return;
      event.preventDefault();
      event.stopPropagation();
      runKeybindingAction(binding.action);
    };
    const handleAction = (event: Event) =>
      runAction(
        (event as CustomEvent<{ type: KeybindingActionType }>).detail.type,
      );

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener(GLOBAL_KEYBINDING_EVENT, handleAction);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener(GLOBAL_KEYBINDING_EVENT, handleAction);
    };
  }, []);

  useEffect(() => {
    return window.electronAPI?.onCloseActiveTab?.(() => {
      if (dispatchCtrlW(document.activeElement)) return;
      closeActiveTabRef.current();
    });
  }, []);

  const [commandPaletteShortcutEnabled, setCommandPaletteShortcutEnabled] =
    useState<boolean>(() => {
      const v = localStorage.getItem("commandPaletteShortcutEnabled");
      return v !== null ? v === "true" : true;
    });

  // Double-shift or Ctrl+K opens the command palette. Double-shift alone was
  // hard to discover.
  useEffect(() => {
    if (!commandPaletteShortcutEnabled) return;
    const shortcut = createCommandPaletteShortcutMatcher();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!shortcut.matches(e)) return;
      if (!isShiftKey(e)) e.preventDefault();
      palette.setOpen((prev) => !prev);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", shortcut.reset);
    window.addEventListener("compositionstart", shortcut.reset);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", shortcut.reset);
      window.removeEventListener("compositionstart", shortcut.reset);
    };
  }, [commandPaletteShortcutEnabled]);

  // Ctrl+Shift+E toggles between the two most recent sidebar panels.
  const railView = regions.left.view;
  const sidebarOpen = regions.left.open;
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.code !== "KeyE") return;
      e.preventDefault();
      const previous = regions.previousView();
      if (!sidebarOpen) {
        regions.left.setOpen(true);
        return;
      }
      if (previous && previous !== railView) regions.railClick(previous);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [railView, sidebarOpen]);

  // Split-screen and tab navigation hotkeys
  // Also registered in globalShortcutHandler so xterm can invoke directly
  // without going through synthetic DOM events (which are unreliable).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
        if (e.code === "KeyF") {
          e.preventDefault();
          toggleFullscreenRef.current();
          return;
        }
      }

      // Ctrl+Shift+\ splits right, Ctrl+Shift+- splits down, Ctrl+Shift+Enter
      // zooms the focused pane.
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
        if (e.code === "Backslash" || e.code === "Minus") {
          e.preventDefault();
          splitActionsRef.current?.splitActive(
            e.code === "Backslash" ? "right" : "bottom",
          );
          return;
        }
        if (e.code === "Enter" && splitActionsRef.current?.zoomFocused()) {
          e.preventDefault();
          return;
        }
      }

      // Alt+Arrow (Cmd+Option+Arrow on macOS) moves between panes of the active split
      const paneDirection = getPaneNavDirection(e);
      if (paneDirection && splitActionsRef.current?.navigate(paneDirection)) {
        e.preventDefault();
        return;
      }

      // Cmd+1..9 on macOS, Alt+1..9 elsewhere: jump directly to the tab at that position
      const tabDigit = getTabJumpDigit(e);
      if (tabDigit !== null) {
        const currentTabs = tabsRef.current.filter(
          (tab) => !tab.parentSplitTabId,
        );
        const index = tabDigit - 1;
        if (index < currentTabs.length) {
          e.preventDefault();
          setActiveTabId(currentTabs[index].id);
        }
        return;
      }

      // Ctrl+Shift+] / Ctrl+Shift+[: cycle through open tabs (] = next, [ = previous)
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
        if (e.code === "BracketRight" || e.code === "BracketLeft") {
          e.preventDefault();
          const currentTabs = tabsRef.current.filter(
            (tab) => !tab.parentSplitTabId,
          );
          if (currentTabs.length < 2) return;
          const currentId = activeTabIdRef.current;
          const idx = currentTabs.findIndex((t) => t.id === currentId);
          const next =
            e.code === "BracketRight"
              ? (idx + 1) % currentTabs.length
              : (idx - 1 + currentTabs.length) % currentTabs.length;
          setActiveTabId(currentTabs[next].id);
          return;
        }
      }
    };

    globalShortcutHandler.current = handleKeyDown;
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      globalShortcutHandler.current = null;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      const v = localStorage.getItem("commandPaletteShortcutEnabled");
      setCommandPaletteShortcutEnabled(v !== null ? v === "true" : true);
    };
    window.addEventListener("commandPaletteShortcutEnabledChanged", handler);
    return () =>
      window.removeEventListener(
        "commandPaletteShortcutEnabledChanged",
        handler,
      );
  }, []);
}
