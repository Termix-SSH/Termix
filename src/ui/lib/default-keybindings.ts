import type { KeyCombo } from "@/types/keybindings";

export interface DefaultKeybindingInfo {
  id: string;
  combo: KeyCombo;
  description: string;
}

export const BUILT_IN_DEFAULTS: DefaultKeybindingInfo[] = [
  {
    id: "default-copy-ctrlc",
    combo: {
      key: "c",
      isCode: false,
      ctrl: true,
      alt: false,
      shift: false,
      meta: false,
    },
    description: "Copy selection (Ctrl+C, only when text is selected)",
  },
  {
    id: "default-copy-ctrlshiftc",
    combo: {
      key: "c",
      isCode: false,
      ctrl: true,
      alt: false,
      shift: true,
      meta: false,
    },
    description: "Copy selection (Ctrl+Shift+C)",
  },
  {
    id: "default-copy-cmdc",
    combo: {
      key: "c",
      isCode: false,
      ctrl: false,
      alt: false,
      shift: false,
      meta: true,
    },
    description: "Copy selection (Cmd+C)",
  },
  {
    id: "default-paste-ctrlshiftv",
    combo: {
      key: "v",
      isCode: false,
      ctrl: true,
      alt: false,
      shift: true,
      meta: false,
    },
    description: "Paste from clipboard (Ctrl+Shift+V)",
  },
  {
    id: "default-ctrlaltw",
    combo: {
      key: "w",
      isCode: false,
      ctrl: true,
      alt: true,
      shift: false,
      meta: false,
    },
    description: "Send Ctrl+W to shell (blocked from closing browser tab)",
  },
  {
    id: "default-ctrlaltt",
    combo: {
      key: "t",
      isCode: false,
      ctrl: true,
      alt: true,
      shift: false,
      meta: false,
    },
    description: "Send Ctrl+T to shell (blocked from opening browser tab)",
  },
  {
    id: "default-ctrlaltn",
    combo: {
      key: "n",
      isCode: false,
      ctrl: true,
      alt: true,
      shift: false,
      meta: false,
    },
    description: "Send Ctrl+N to shell (blocked from opening browser window)",
  },
  {
    id: "default-ctrlaltq",
    combo: {
      key: "q",
      isCode: false,
      ctrl: true,
      alt: true,
      shift: false,
      meta: false,
    },
    description: "Send Ctrl+Q to shell (blocked from quitting browser)",
  },
];
