/**
 * Browser features an opaque origin lacks or must not use on its own. Loaded
 * before anything else in the frame, so core and plugin code find working
 * stand-ins: storage kept by the shell, no cookies, and links, downloads and
 * the clipboard handed to the shell.
 */

export interface ShimTarget {
  /** Saves one storage change in the shell. null removes the key. */
  saveStorage: (key: string, value: string | null) => void;
  openUrl: (url: string) => void;
  download: (blob: Blob, name: string) => void;
  writeClipboard: (text: string) => Promise<void>;
  readClipboard: () => Promise<string>;
  /** Each clipboard item as a map from type to Blob. */
  readClipboardItems: () => Promise<unknown[]>;
}

let target: ShimTarget | null = null;
const pending: Array<(target: ShimTarget) => void> = [];

function withTarget(run: (target: ShimTarget) => void) {
  if (target) run(target);
  else pending.push(run);
}

export function connectShims(next: ShimTarget): void {
  target = next;
  for (const run of pending.splice(0)) run(next);
}

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  constructor(private readonly persist: boolean) {}

  get length() {
    return this.data.size;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.data.has(String(key)) ? this.data.get(String(key))! : null;
  }
  setItem(key: string, value: string) {
    const name = String(key);
    const text = String(value);
    this.data.set(name, text);
    if (this.persist) withTarget((t) => t.saveStorage(name, text));
  }
  removeItem(key: string) {
    const name = String(key);
    if (!this.data.delete(name)) return;
    if (this.persist) withTarget((t) => t.saveStorage(name, null));
  }
  clear() {
    for (const key of [...this.data.keys()]) this.removeItem(key);
  }
  /** Fills from the shell's copy without writing back. */
  load(values: Record<string, string>) {
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === "string") this.data.set(key, value);
    }
  }
}

export const frameLocalStorage = new MemoryStorage(true);
const frameSessionStorage = new MemoryStorage(false);

function define(object: object, name: string, value: unknown) {
  try {
    Object.defineProperty(object, name, {
      configurable: true,
      get: () => value,
    });
  } catch {
    // Not redefinable here; the original stays.
  }
}

/**
 * A ClipboardItem from the shell's copy, or a stand-in where the frame has
 * none.
 */
function clipboardItem(value: unknown): ClipboardItem | null {
  if (!value || typeof value !== "object") return null;
  const data = Object.fromEntries(
    Object.entries(value).filter(([, blob]) => blob instanceof Blob),
  ) as Record<string, Blob>;
  const types = Object.keys(data);
  if (types.length === 0) return null;
  if (typeof ClipboardItem === "function") return new ClipboardItem(data);
  return {
    types,
    presentationStyle: "unspecified",
    getType: async (type: string) => {
      if (!Object.hasOwn(data, type)) {
        throw new DOMException(`No ${type} on the clipboard`, "NotFoundError");
      }
      return data[type];
    },
  } as ClipboardItem;
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url, location.href);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function installShims(): void {
  if (typeof window === "undefined") return;
  define(window, "localStorage", frameLocalStorage);
  define(window, "sessionStorage", frameSessionStorage);
  try {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: () => {},
    });
  } catch {
    // Reading it throws in an opaque origin; nothing else to do.
  }

  window.open = ((url?: string | URL) => {
    const href = url ? String(url) : "";
    if (isHttpUrl(href)) {
      withTarget((t) => t.openUrl(new URL(href, location.href).href));
    }
    return null;
  }) as typeof window.open;

  // A sandbox without popups can't follow target=_blank links or save files,
  // so the shell does both.
  document.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.hasAttribute("download")) {
        event.preventDefault();
        const name = anchor.getAttribute("download") || "download";
        void fetch(anchor.href)
          .then((response) => response.blob())
          .then((blob) => withTarget((t) => t.download(blob, name)))
          .catch(() => {});
        return;
      }
      if (
        anchor.target &&
        anchor.target !== "_self" &&
        isHttpUrl(anchor.href)
      ) {
        event.preventDefault();
        withTarget((t) => t.openUrl(anchor.href));
      }
    },
    true,
  );

  const clipboard = {
    writeText: (text: string) =>
      new Promise<void>((resolve, reject) =>
        withTarget((t) => t.writeClipboard(String(text)).then(resolve, reject)),
      ),
    readText: () =>
      new Promise<string>((resolve, reject) =>
        withTarget((t) => t.readClipboard().then(resolve, reject)),
      ),
    // Pictures and plain text, read by the shell right after a click here.
    read: () =>
      new Promise<ClipboardItem[]>((resolve, reject) =>
        withTarget((t) =>
          t.readClipboardItems().then((items) => {
            resolve(
              items
                .map(clipboardItem)
                .filter((item): item is ClipboardItem => item !== null),
            );
          }, reject),
        ),
      ),
  };
  try {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      get: () => clipboard,
    });
  } catch {
    // Left as the browser has it.
  }
}
