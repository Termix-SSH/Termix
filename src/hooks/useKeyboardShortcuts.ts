import { useEffect } from "react";

interface KeyboardShortcut {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  action: () => void;
  description: string;
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      shortcuts.forEach((shortcut) => {
        const keyMatches = event.key.toLowerCase() === shortcut.key.toLowerCase();
        const ctrlMatches = !!shortcut.ctrlKey === event.ctrlKey;
        const altMatches = !!shortcut.altKey === event.altKey;
        const shiftMatches = !!shortcut.shiftKey === event.shiftKey;
        const metaMatches = !!shortcut.metaKey === event.metaKey;

        if (keyMatches && ctrlMatches && altMatches && shiftMatches && metaMatches) {
          event.preventDefault();
          shortcut.action();
        }
      });
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts]);
}

export const defaultShortcuts: KeyboardShortcut[] = [
  {
    key: "h",
    ctrlKey: true,
    action: () => {
      // Navigate to homepage
      window.location.hash = "#homepage";
    },
    description: "Go to Homepage",
  },
  {
    key: "t",
    ctrlKey: true,
    action: () => {
      // Navigate to terminal
      window.location.hash = "#terminal";
    },
    description: "Open Terminal",
  },
  {
    key: "f",
    ctrlKey: true,
    action: () => {
      // Navigate to file manager
      window.location.hash = "#file-manager";
    },
    description: "Open File Manager",
  },
  {
    key: "n",
    ctrlKey: true,
    action: () => {
      // Navigate to host manager
      window.location.hash = "#host-manager";
    },
    description: "Add New Host",
  },
  {
    key: "k",
    ctrlKey: true,
    action: () => {
      // Navigate to credentials
      window.location.hash = "#credentials";
    },
    description: "Manage Credentials",
  },
  {
    key: "?",
    action: () => {
      // Show keyboard shortcuts help
      console.log("Keyboard Shortcuts:", defaultShortcuts.map(s => `${s.key} - ${s.description}`));
    },
    description: "Show Keyboard Shortcuts",
  },
];
