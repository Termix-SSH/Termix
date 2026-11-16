/**
 * Reports where this frame's placeholders are, so the shell can draw other
 * plugins' views over them. Every change is gathered and sent once per
 * animation frame: rect, what the frame's own scroll boxes show of it,
 * whether it is on screen, its stacking, and open menus that cover views.
 */

export interface PlacedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Entry {
  element: HTMLElement;
  interactive: boolean;
  last: string;
}

export interface PlaceBatch {
  views: Array<{
    id: string;
    rect: PlacedRect;
    clip: PlacedRect | null;
    visible: boolean;
    interactive: boolean;
    z: number;
    /** Open menus and popovers drawn over this placeholder. */
    covers: PlacedRect[];
  }>;
  dragging?: boolean;
}

/** How long to keep measuring after a change, for transitions. */
const SETTLE_MS = 600;

const round = (n: number) => Math.round(n * 100) / 100;

function rectOf(element: Element): PlacedRect {
  const box = element.getBoundingClientRect();
  return {
    x: round(box.left),
    y: round(box.top),
    width: round(box.width),
    height: round(box.height),
  };
}

function intersect(a: PlacedRect, b: PlacedRect): PlacedRect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return { x, y, width: 0, height: 0 };
  return { x, y, width: right - x, height: bottom - y };
}

const cuts = (value: string) => !!value && value !== "visible";

function clips(style: CSSStyleDeclaration): boolean {
  return (
    cuts(style.overflow) ||
    cuts(style.overflowX) ||
    cuts(style.overflowY) ||
    (!!style.clipPath && style.clipPath !== "none")
  );
}

/** Every box above an element that cuts what it shows. */
export function scrollParents(element: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  let node = element.parentElement;
  while (node && node !== document.documentElement) {
    if (node !== document.body && clips(getComputedStyle(node))) out.push(node);
    node = node.parentElement;
  }
  return out;
}

/** The nearest box that scrolls, for wheel moves the shell hands back. */
export function scrollTarget(element: Element): Element {
  let node = element.parentElement;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    const scrollsY =
      /(auto|scroll|overlay)/.test(style.overflowY || style.overflow) &&
      node.scrollHeight > node.clientHeight;
    const scrollsX =
      /(auto|scroll|overlay)/.test(style.overflowX || style.overflow) &&
      node.scrollWidth > node.clientWidth;
    if (scrollsX || scrollsY) return node;
    node = node.parentElement;
  }
  return document.scrollingElement ?? document.documentElement;
}

function stackLevel(element: Element): number {
  let level = 0;
  let node: Element | null = element;
  while (node && node !== document.body) {
    const z = Number.parseInt(getComputedStyle(node).zIndex, 10);
    if (Number.isFinite(z)) level = Math.max(level, z);
    node = node.parentElement;
  }
  return level;
}

function isShown(element: HTMLElement): boolean {
  const check = (
    element as HTMLElement & {
      checkVisibility?: (options?: Record<string, boolean>) => boolean;
    }
  ).checkVisibility;
  return check
    ? check.call(element, { visibilityProperty: true, opacityProperty: true })
    : true;
}

export class ForeignPlacer {
  private entries = new Map<string, Entry>();
  private occluders = new Set<Element>();
  private dragging = false;
  private lastDragging = false;
  private frame = 0;
  private settleUntil = 0;
  private resize: ResizeObserver | null = null;
  private intersection: IntersectionObserver | null = null;
  private mutation: MutationObserver | null = null;
  private listening = false;

  constructor(
    private readonly send: (batch: PlaceBatch) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  add(id: string, element: HTMLElement, interactive: boolean): void {
    this.entries.set(id, { element, interactive, last: "" });
    this.listen();
    this.resize?.observe(element);
    this.intersection?.observe(element);
    this.kick();
  }

  update(id: string, interactive: boolean): void {
    const entry = this.entries.get(id);
    if (!entry || entry.interactive === interactive) return;
    entry.interactive = interactive;
    this.kick();
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.resize?.unobserve(entry.element);
    this.intersection?.unobserve(entry.element);
    if (this.entries.size === 0) this.stopListening();
  }

  addOccluder(element: Element): () => void {
    this.occluders.add(element);
    this.kick();
    return () => {
      if (this.occluders.delete(element)) this.kick();
    };
  }

  setDragging(dragging: boolean): void {
    if (this.dragging === dragging) return;
    this.dragging = dragging;
    this.kick();
  }

  /** Something may have moved: measure on the next frame, and a little after. */
  kick = (): void => {
    this.settleUntil = this.now() + SETTLE_MS;
    if (this.frame || typeof requestAnimationFrame === "undefined") return;
    this.frame = requestAnimationFrame(this.flush);
  };

  /** Measures every placeholder and sends what changed. */
  flush = (): void => {
    this.frame = 0;
    const viewport: PlacedRect = {
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
    const batch: PlaceBatch = { views: [] };
    const open = [...this.occluders]
      .filter((element) => element.isConnected)
      .map((element) => ({ element, rect: rectOf(element) }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0);
    for (const [id, entry] of this.entries) {
      const { element } = entry;
      const rect = rectOf(element);
      let clip: PlacedRect | null = null;
      for (const parent of scrollParents(element)) {
        const box = rectOf(parent);
        clip = clip ? intersect(clip, box) : box;
      }
      const seen = intersect(clip ?? rect, viewport);
      const visible =
        element.isConnected &&
        isShown(element) &&
        seen.width > 0 &&
        seen.height > 0;
      // A menu covers a placeholder that sits before it in the page and not
      // inside it: a dialog's own parts stay, the page under it hides.
      const covers = open
        .filter(
          (occluder) =>
            !occluder.element.contains(element) &&
            !!(
              element.compareDocumentPosition(occluder.element) &
              Node.DOCUMENT_POSITION_FOLLOWING
            ),
        )
        .map((occluder) => occluder.rect);
      const view = {
        id,
        rect,
        clip,
        visible,
        interactive: entry.interactive,
        z: stackLevel(element),
        covers,
      };
      const json = JSON.stringify(view);
      if (json === entry.last) continue;
      entry.last = json;
      batch.views.push(view);
    }
    if (this.dragging !== this.lastDragging) {
      this.lastDragging = this.dragging;
      batch.dragging = this.dragging;
    }
    if (batch.views.length || batch.dragging !== undefined) {
      this.send(batch);
    }
    if (
      (this.entries.size > 0 || this.occluders.size > 0) &&
      this.now() < this.settleUntil &&
      typeof requestAnimationFrame !== "undefined"
    ) {
      this.frame = requestAnimationFrame(this.flush);
    }
  };

  /** Sends every placeholder again, as after the shell lost track. */
  resend(): void {
    for (const entry of this.entries.values()) entry.last = "";
    this.kick();
  }

  private listen(): void {
    if (this.listening || typeof window === "undefined") return;
    this.listening = true;
    if (typeof ResizeObserver !== "undefined") {
      this.resize = new ResizeObserver(this.kick);
      this.resize.observe(document.documentElement);
    }
    if (typeof IntersectionObserver !== "undefined") {
      this.intersection = new IntersectionObserver(this.kick, {
        threshold: [0, 0.01, 0.5, 0.99, 1],
      });
    }
    if (typeof MutationObserver !== "undefined") {
      // Layout moves without a resize: a drag, a sibling growing, a class.
      this.mutation = new MutationObserver(this.kick);
      this.mutation.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["style", "class", "hidden", "open", "data-state"],
      });
    }
    // Capture sees every scroll box's scroll, not just the window's.
    window.addEventListener("scroll", this.kick, true);
    window.addEventListener("resize", this.kick);
    document.addEventListener("transitionrun", this.kick, true);
    document.addEventListener("animationstart", this.kick, true);
  }

  private stopListening(): void {
    if (!this.listening) return;
    this.listening = false;
    this.resize?.disconnect();
    this.intersection?.disconnect();
    this.mutation?.disconnect();
    this.resize = null;
    this.intersection = null;
    this.mutation = null;
    window.removeEventListener("scroll", this.kick, true);
    window.removeEventListener("resize", this.kick);
    document.removeEventListener("transitionrun", this.kick, true);
    document.removeEventListener("animationstart", this.kick, true);
  }
}
