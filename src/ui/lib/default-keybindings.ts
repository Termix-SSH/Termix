import type { KeyCombo } from "@/types/keybindings";

export interface DefaultKeybindingInfo {
  id: string;
  combo: KeyCombo;
  descriptionKey: string;
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
    descriptionKey: "newUi.sidebar.keybindings.builtIn.copyCtrlC",
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
    descriptionKey: "newUi.sidebar.keybindings.builtIn.copyCtrlShiftC",
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
    descriptionKey: "newUi.sidebar.keybindings.builtIn.copyCmdC",
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
    descriptionKey: "newUi.sidebar.keybindings.builtIn.pasteCtrlShiftV",
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
    descriptionKey: "newUi.sidebar.keybindings.builtIn.ctrlW",
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
    descriptionKey: "newUi.sidebar.keybindings.builtIn.ctrlT",
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
    descriptionKey: "newUi.sidebar.keybindings.builtIn.ctrlN",
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
    descriptionKey: "newUi.sidebar.keybindings.builtIn.ctrlQ",
  },
];
