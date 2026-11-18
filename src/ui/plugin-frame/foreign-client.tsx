/* eslint-disable react-refresh/only-export-components */
/**
 * The frame side of other plugins' parts. Lists of a slot's, extension
 * point's or component id's parts come from the shell as plain data; each
 * part's component is a placeholder here, and the shell draws the real view
 * over it. The frame never gets a handle on the other plugin's frame.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type CSSProperties,
} from "react";
import i18n from "@/i18n/i18n";
import type { SlotContribution } from "@/shell/action-registry";
import type { RegisteredExtension } from "@/plugin-host/extension-registry";
import { frameRowContext } from "@/plugin-host/frames/data-rows";
import {
  ForeignSlot,
  useForeignInteractive,
} from "@/components/foreign/ForeignSlot";
import {
  markForeign,
  type ForeignPartFit,
  type ForeignRuntime,
  type ForeignTarget,
  type PlaceholderProps,
} from "@/components/foreign/foreign-runtime";
import { decodeIcon, decodeIconValue } from "./frame-icons";
import { ForeignPlacer, scrollTarget, type PlaceBatch } from "./foreign-placer";
import { propsSignature, useStableProps } from "./stable-props";
import { tabbables } from "./frame-edges";
import { useInSeamlessTile } from "@/components/tile-grid/context";

type Call = (method: string, ...args: unknown[]) => Promise<unknown>;
type Emit = (name: string, data?: unknown) => void;
type Kind = "slot" | "extension" | "component" | "tab";
type AnyComponent = ComponentType<Record<string, unknown>>;

interface ListState {
  listId: string;
  kind: Kind;
  id: string;
  context: Record<string, unknown>;
  refs: number;
  raw: Record<string, unknown>[];
  /** Decoded items, rebuilt when raw changes. */
  items: unknown[];
  components: Map<string, AnyComponent>;
  listeners: Set<() => void>;
  unlistTimer: ReturnType<typeof setTimeout> | null;
  refused: boolean;
}

/** How long an unused list stays, so a quick remount keeps its views. */
const UNLIST_DELAY_MS = 2_000;
const NONE: unknown[] = [];

let call: Call | null = null;
let emit: Emit | null = null;
let placer: ForeignPlacer | null = null;
const lists = new Map<string, ListState>();
const byListId = new Map<string, ListState>();
let nextList = 1;
let nextView = 1;

interface ViewHandlers {
  size: (size: { width: number; height: number }) => void;
  shown: () => void;
  focusOut: (dir: "next" | "prev") => void;
  wheel: (dx: number, dy: number) => void;
}
const views = new Map<string, ViewHandlers>();

function listKey(kind: Kind, id: string, context: Record<string, unknown>) {
  return `${kind}\u0000${id}\u0000${JSON.stringify(context)}`;
}

function foreignComponent(
  list: ListState,
  itemKey: string,
  fit: ForeignPartFit,
): AnyComponent {
  const cacheKey = `${itemKey}\u0000${fit}`;
  let component = list.components.get(cacheKey);
  if (!component) {
    const target: ForeignTarget = { listId: list.listId, itemKey, fit };
    const Part: AnyComponent = (props) => (
      <ForeignSlot of={Part} props={props} />
    );
    Part.displayName = `Foreign(${list.id}:${itemKey})`;
    markForeign(Part, target);
    component = Part;
    list.components.set(cacheKey, component);
  }
  return component;
}

function readFit(value: unknown): ForeignPartFit {
  return value === "fill" ||
    value === "inline" ||
    value === "overlay" ||
    value === "content"
    ? value
    : "content";
}

function markerKey(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const key = (value as { $foreign?: unknown }).$foreign;
  return typeof key === "string" ? key : undefined;
}

function decodeItems(list: ListState): unknown[] {
  if (list.kind === "slot") {
    return list.raw.map((item) => {
      const fit = readFit(item.fit);
      const key = markerKey(item.component);
      return {
        actionId: String(item.actionId ?? item.key),
        titleKey: String(item.titleKey ?? ""),
        descriptionKey:
          typeof item.descriptionKey === "string"
            ? item.descriptionKey
            : undefined,
        icon: decodeIcon(item.icon),
        kind: typeof item.kind === "string" ? item.kind : "button",
        order: typeof item.order === "number" ? item.order : undefined,
        pluginId: typeof item.pluginId === "string" ? item.pluginId : undefined,
        component: key ? foreignComponent(list, key, fit) : undefined,
      } satisfies SlotContribution;
    });
  }
  if (list.kind === "extension") {
    return list.raw.map((item) => {
      const {
        components,
        icon,
        key: _key,
        ...rest
      } = item as Record<string, unknown> & {
        components?: Record<string, unknown>;
      };
      const parts: Record<string, AnyComponent> = {};
      for (const [name, value] of Object.entries(components ?? {})) {
        const key = markerKey(value);
        if (!key) continue;
        const fit: ForeignPartFit = /^label$/i.test(name)
          ? "inline"
          : /form|editor|settings/i.test(name)
            ? "content"
            : "fill";
        parts[name] = foreignComponent(list, key, fit);
      }
      return {
        ...rest,
        id: String(rest.id ?? ""),
        icon: icon === undefined ? undefined : decodeIconValue(icon),
        components: parts,
      } as RegisteredExtension;
    });
  }
  const first = list.raw[0];
  const key = markerKey(first?.component);
  return key ? [foreignComponent(list, key, readFit(first.fit))] : [];
}

/** The other plugins' strings this frame needs, under their own keys. */
export function addStrings(strings: unknown) {
  if (!strings || typeof strings !== "object") return;
  const language = i18n.language || "en";
  const separator = (i18n.options?.nsSeparator as string | false) ?? ":";
  for (const [key, text] of Object.entries(strings)) {
    if (typeof text !== "string") continue;
    let ns = (i18n.options?.defaultNS as string | undefined) ?? "translation";
    let path = key;
    if (separator && key.includes(separator)) {
      const at = key.indexOf(separator);
      ns = key.slice(0, at);
      path = key.slice(at + separator.length);
    }
    try {
      i18n.addResource(language, ns, path, text);
    } catch {
      // A key that clashes with a branch stays untranslated.
    }
  }
}

function notify(list: ListState) {
  for (const listener of [...list.listeners]) listener();
}

function acquire(
  kind: Kind,
  id: string,
  rawContext?: Record<string, unknown>,
): ListState {
  const context = frameRowContext(rawContext);
  const key = listKey(kind, id, context);
  let list = lists.get(key);
  if (!list) {
    list = {
      listId: `l${nextList++}`,
      kind,
      id,
      context,
      refs: 0,
      raw: [],
      items: NONE,
      components: new Map(),
      listeners: new Set(),
      unlistTimer: null,
      refused: false,
    };
    lists.set(key, list);
    byListId.set(list.listId, list);
    const started = list;
    // A list read during a render that never mounted is let go.
    setTimeout(() => {
      if (started.refs === 0 && !started.unlistTimer) {
        started.refs = 1;
        release(started);
      }
    }, UNLIST_DELAY_MS);
    void call?.("foreign.list", list.listId, kind, id, context)
      .then((ok) => {
        if (ok === true) return;
        started.refused = true;
        if (import.meta.env.DEV) {
          console.warn(
            `[foreign] ${kind} ${id} was refused: declare it, own its id or list it in contributes.uses`,
          );
        }
      })
      .catch(() => {
        started.refused = true;
      });
  }
  if (list.unlistTimer) {
    clearTimeout(list.unlistTimer);
    list.unlistTimer = null;
  }
  return list;
}

function release(list: ListState) {
  list.refs -= 1;
  if (list.refs > 0 || list.unlistTimer) return;
  list.unlistTimer = setTimeout(() => {
    list.unlistTimer = null;
    if (list.refs > 0) return;
    lists.delete(listKey(list.kind, list.id, list.context));
    byListId.delete(list.listId);
    void call?.("foreign.unlist", list.listId).catch(() => {});
  }, UNLIST_DELAY_MS);
}

function useList(
  kind: Kind,
  id: string,
  context?: Record<string, unknown>,
): unknown[] {
  let contextJson = "";
  try {
    contextJson = JSON.stringify(frameRowContext(context));
  } catch {
    contextJson = "";
  }
  const list = useMemo(
    () => acquire(kind, id, contextJson ? JSON.parse(contextJson) : {}),
    [kind, id, contextJson],
  );
  useEffect(() => {
    list.refs += 1;
    return () => release(list);
  }, [list]);
  return useSyncExternalStore(
    (listener) => {
      list.listeners.add(listener);
      return () => {
        list.listeners.delete(listener);
      };
    },
    () => list.items,
    () => list.items,
  );
}

/** Moves focus past a placeholder, the way Tab would have. */
export function focusPast(placeholder: HTMLElement, dir: "next" | "prev") {
  const all = tabbables().filter(
    (element) => element !== placeholder && !placeholder.contains(element),
  );
  const after = (element: HTMLElement) =>
    !!(
      placeholder.compareDocumentPosition(element) &
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  const target =
    dir === "next"
      ? all.find(after)
      : [...all].reverse().find((e) => !after(e));
  if (target) target.focus();
  else placeholder.blur();
}

function fitStyle(
  fit: ForeignPartFit,
  size: { width: number; height: number } | null,
): CSSProperties {
  switch (fit) {
    case "fill":
      return {
        display: "block",
        width: "100%",
        height: "100%",
        flex: "1 1 auto",
        minHeight: 0,
      };
    case "inline":
      return {
        display: "inline-block",
        verticalAlign: "middle",
        width: size ? size.width : 0,
        height: size ? size.height : 0,
      };
    case "overlay":
      return { position: "absolute", inset: 0, pointerEvents: "none" };
    default:
      return {
        display: "block",
        width: "100%",
        height: size ? size.height : 0,
      };
  }
}

function Placeholder({
  target,
  props,
  interactive = true,
  className,
  style,
}: PlaceholderProps) {
  const inherited = useForeignInteractive();
  const live = interactive && inherited;
  const element = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const id = useMemo(
    () => `v${nextView++}`,
    // A new part is a new placeholder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target.listId, target.itemKey, target.web],
  );
  // A tile around the placeholder draws the border, so the part drops its
  // own. The shell can't see this frame's tiles, so it goes with the props.
  const seamless = useInSeamlessTile();
  const seamlessRef = useRef(seamless);
  seamlessRef.current = seamless;
  const placedProps = useMemo(
    () => (seamless ? { ...props, __place: { seamless: true } } : props),
    [props, seamless],
  );
  const stable = useStableProps(placedProps);
  const stableRef = useRef(stable);
  stableRef.current = stable;
  const lastSent = useRef<string | null>(null);
  const [mounted, setMounted] = useState(false);
  // The part painted, so a page can wait for its parts before showing.
  const [shown, setShown] = useState(false);
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    const node = element.current;
    if (!node || !call) return;
    let alive = true;
    views.set(id, {
      size: (next) => setSize(next),
      shown: () => setShown(true),
      focusOut: (dir) => focusPast(node, dir),
      wheel: (dx, dy) => scrollTarget(node).scrollBy(dx, dy),
    });
    lastSent.current = propsSignature(stableRef.current);
    void call(
      "foreign.mount",
      target.web
        ? { id, web: target.web }
        : {
            id,
            listId: target.listId,
            itemKey: target.itemKey,
            props: stableRef.current,
          },
    )
      .then((ok) => {
        if (!alive || ok !== true) return;
        placer?.add(id, node, liveRef.current, seamlessRef.current);
        setMounted(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
      views.delete(id);
      placer?.remove(id);
      emit?.("foreign.dispose", { id });
      setMounted(false);
      setShown(false);
    };
  }, [id, target.listId, target.itemKey, target.web]);

  useEffect(() => {
    if (!mounted) return;
    const signature = propsSignature(stable);
    if (signature !== null && signature === lastSent.current) return;
    lastSent.current = signature;
    emit?.("foreign.props", { id, props: stable });
  }, [mounted, stable, id]);

  useEffect(() => {
    if (mounted) placer?.update(id, live);
  }, [mounted, live, id]);

  const focusable = live && target.fit !== "overlay";
  return (
    <div
      ref={element}
      data-foreign-slot={target.itemKey}
      data-foreign-id={id}
      data-foreign-shown={shown ? "" : undefined}
      tabIndex={focusable ? 0 : -1}
      className={className}
      style={{ ...fitStyle(target.fit, size), ...style }}
      onFocus={(event) => {
        if (event.target !== event.currentTarget || !focusable) return;
        const from = event.relatedTarget as Node | null;
        const fromAfter =
          !!from &&
          !!(
            event.currentTarget.compareDocumentPosition(from) &
            Node.DOCUMENT_POSITION_FOLLOWING
          );
        void call?.("foreign.focus", id, fromAfter ? "last" : "first");
      }}
    />
  );
}

function getExtension(
  pointId: string,
  id: string,
): RegisteredExtension | undefined {
  let found: RegisteredExtension | undefined;
  let listed = false;
  for (const list of byListId.values()) {
    if (list.kind !== "extension" || list.id !== pointId) continue;
    listed = true;
    found = (list.items as RegisteredExtension[]).find(
      (item) => item.id === id,
    );
    if (found) return found;
  }
  // Not listed yet: keep a list open so the next read finds it.
  if (!listed) acquire("extension", pointId).refs += 1;
  return undefined;
}

export function createForeignRuntime(options: {
  call: Call;
  emit: Emit;
  /** See ForeignRuntime.withOwn. */
  withOwn?: boolean;
}): ForeignRuntime {
  call = options.call;
  emit = options.emit;
  placer = new ForeignPlacer((batch: PlaceBatch) =>
    emit?.("foreign.place", batch),
  );
  if (typeof window !== "undefined") {
    window.addEventListener(
      "pointerdown",
      () => placer?.setDragging(true),
      true,
    );
    const end = () => placer?.setDragging(false);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    window.addEventListener("blur", end);
  }
  return {
    withOwn: options.withOwn,
    useSlot: (slotId, context) =>
      useList("slot", slotId, context) as SlotContribution[],
    useExtensions: (pointId) =>
      useList("extension", pointId) as RegisteredExtension[],
    getExtension,
    useComponent: (id) =>
      (useList("component", id)[0] as AnyComponent | undefined) ?? undefined,
    useTab: (type, hostId) =>
      (useList("tab", type, { hostId })[0] as AnyComponent | undefined) ??
      undefined,
    invoke: (actionId, args) => options.call("invokeAction", actionId, ...args),
    Placeholder,
    addOccluder: (element) => placer?.addOccluder(element) ?? (() => {}),
  };
}

/** Events from the shell for foreign parts. Returns false for other events. */
export function receiveForeignEvent(name: string, data: unknown): boolean {
  if (!name.startsWith("foreign.")) return false;
  const entry = (data ?? {}) as Record<string, unknown>;
  if (name === "foreign.items") {
    const list =
      typeof entry.listId === "string" ? byListId.get(entry.listId) : undefined;
    if (!list || !Array.isArray(entry.items)) return true;
    addStrings(entry.strings);
    list.raw = entry.items.filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object",
    );
    list.items = decodeItems(list);
    notify(list);
    return true;
  }
  const view = typeof entry.id === "string" ? views.get(entry.id) : undefined;
  if (!view) return true;
  if (name === "foreign.size") {
    const size = entry.size as { width?: unknown; height?: unknown } | null;
    if (typeof size?.width === "number" && typeof size.height === "number") {
      view.size({ width: size.width, height: size.height });
    }
  } else if (name === "foreign.shown") {
    view.shown();
  } else if (name === "foreign.focusOut") {
    view.focusOut(entry.dir === "prev" ? "prev" : "next");
  } else if (name === "foreign.wheel") {
    if (typeof entry.dx === "number" && typeof entry.dy === "number") {
      view.wheel(entry.dx, entry.dy);
    }
  }
  return true;
}

/** Test seam. */
export function resetForeignClient(): void {
  for (const list of lists.values()) {
    if (list.unlistTimer) clearTimeout(list.unlistTimer);
  }
  lists.clear();
  byListId.clear();
  views.clear();
  call = null;
  emit = null;
  placer = null;
}
