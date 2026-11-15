/* eslint-disable react-refresh/only-export-components */
/**
 * Other plugins' views inside a framed plugin.
 *
 * A frame can't draw another plugin, and nesting the other plugin's frame
 * inside it would let a frame pose as any plugin. So the consumer frame
 * draws a placeholder and reports where it is; the shell draws the
 * provider's own view over that spot, in a layer clipped to what the page
 * shows of the consumer frame. The consumer only ever learns sizes, focus
 * and wheel moves for its own placeholder ids. The provider gets its props
 * through the shell and never learns who placed it.
 */

import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { useActionSlot } from "@/hooks/use-action-slot";
import { useExtensions } from "../extension-registry";
import { usePluginComponent } from "../component-registry";

import { getSharedState, hostsFor } from "./frame-state";
import { frameRowContext } from "./data-rows";
import { mayPlaceForeign, type ForeignKind } from "./foreign-policy";
import {
  isEmpty,
  placeView,
  readRect,
  visibleBox,
  EMPTY_RECT,
  type Placement,
  type Rect,
} from "./foreign-placement";
import {
  PluginFrameView,
  type FrameControl,
  type FrameFit,
} from "./PluginFrameView";
import { frameMetaOf } from "./frame-meta";
import { GrantedWebView, type WebPlace } from "./granted-web-view";
import { resolveSlotFit } from "./slot-fit";
import {
  componentItems,
  extensionItems,
  slotItems,
  type BuiltList,
  type PartEntry,
} from "./foreign-items";

/** Lists and views one consumer frame may hold at once. */
export const MAX_LISTS = 100;
export const MAX_VIEWS = 300;
const MAX_ID = 40;
const MAX_OCCLUDERS = 20;

export type ForeignFit = FrameFit;

type ListItem = PartEntry;

interface ForeignList {
  listId: string;
  kind: ForeignKind;
  id: string;
  context: Record<string, unknown>;
  items: Map<string, ListItem>;
  actions: Set<string>;
  last: string;
}

interface ForeignView {
  id: string;
  listId: string;
  itemKey: string;
  props: Record<string, unknown>;
  placement: Placement;
  interactive: boolean;
  z: number;
  /** The consumer's open menus over this view, frame coords. */
  covers: Rect[];
  drawn: boolean;
  el: HTMLDivElement | null;
  control: FrameControl | null;
  /** A page the consumer's own backend granted, instead of a part. */
  web?: string;
  /** Where a web view may show, for native views CSS can't clip. */
  place?: WebPlace;
}

interface Consumer {
  owner: string;
  pluginId: string;
  iframe: HTMLIFrameElement;
  emit: (name: string, data: unknown) => void;
  lists: Map<string, ForeignList>;
  views: Map<string, ForeignView>;
  dragging: boolean;
  layer: HTMLDivElement | null;
  frame: Rect;
  box: Rect;
  shown: boolean;
  ancestors: HTMLElement[];
  ticks: number;
  dirty: boolean;
}

const consumers = new Map<string, Consumer>();
const listeners = new Set<() => void>();
let version = 0;

function emitChange() {
  version += 1;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= MAX_ID
  );
}

/** The shell's record for a host id, as one plugin may see it. */
function scopedHost(
  hostId: unknown,
  pluginId: string,
): Record<string, unknown> | undefined {
  const host = getSharedState().shellHosts.find(
    (entry) => String(entry.id) === String(hostId),
  );
  return host ? hostsFor(pluginId, [host])[0] : undefined;
}

const HOST_PROPS = ["host", "sshHost", "hostConfig"];

/**
 * A host the consumer passes is its own copy, with its own settings. The
 * provider gets the shell's host as the provider may see it instead.
 */
export function scopeHostProps(
  props: Record<string, unknown>,
  providerId: string,
): Record<string, unknown> {
  const out = { ...props };
  for (const name of HOST_PROPS) {
    const value = out[name];
    if (!value || typeof value !== "object") continue;
    const id = (value as { id?: unknown }).id;
    if (id === undefined) continue;
    const host = scopedHost(id, providerId);
    if (host) out[name] = host;
    else delete out[name];
  }
  return out;
}

function getConsumer(
  owner: string,
  pluginId: string,
  iframe: HTMLIFrameElement,
  emit: Consumer["emit"],
): Consumer {
  let consumer = consumers.get(owner);
  if (!consumer) {
    consumer = {
      owner,
      pluginId,
      iframe,
      emit,
      lists: new Map(),
      views: new Map(),
      dragging: false,
      layer: null,
      frame: EMPTY_RECT,
      box: EMPTY_RECT,
      shown: false,
      ancestors: [],
      ticks: 0,
      dirty: true,
    };
    consumers.set(owner, consumer);
  }
  return consumer;
}

export interface ForeignConsumerRef {
  owner: string;
  pluginId: string;
  iframe: HTMLIFrameElement;
  emit: (name: string, data: unknown) => void;
}

/** Makes sure a frame has its layer state, for a web view with no lists. */
export function ensureForeignConsumer(ref: ForeignConsumerRef): void {
  getConsumer(ref.owner, ref.pluginId, ref.iframe, ref.emit);
}

/** A consumer asks for the parts of a slot, extension point or component. */
export function addForeignList(
  ref: ForeignConsumerRef,
  listId: unknown,
  kind: unknown,
  id: unknown,
  context: unknown,
): boolean {
  if (!validId(listId) || typeof id !== "string") return false;
  if (!mayPlaceForeign(ref.pluginId, kind, id)) return false;
  const consumer = getConsumer(ref.owner, ref.pluginId, ref.iframe, ref.emit);
  if (!consumer.lists.has(listId) && consumer.lists.size >= MAX_LISTS) {
    return false;
  }
  const clean = frameRowContext(
    context && typeof context === "object"
      ? (context as Record<string, unknown>)
      : {},
  );
  consumer.lists.set(listId, {
    listId,
    kind: kind as ForeignKind,
    id,
    context: clean,
    items: new Map(),
    actions: new Set(),
    last: "",
  });
  emitChange();
  return true;
}

export function removeForeignList(owner: string, listId: unknown): void {
  const consumer = consumers.get(owner);
  if (!consumer || typeof listId !== "string") return;
  if (!consumer.lists.delete(listId)) return;
  for (const [id, view] of consumer.views) {
    if (view.listId === listId) consumer.views.delete(id);
  }
  emitChange();
}

/** A button in a listed slot may be run by the frame that listed it. */
export function foreignAllowsAction(owner: string, actionId: unknown): boolean {
  const consumer = consumers.get(owner);
  if (!consumer || typeof actionId !== "string") return false;
  for (const list of consumer.lists.values()) {
    if (list.actions.has(actionId)) return true;
  }
  return false;
}

const GRANT = /^[0-9a-f]{48}$/;

/**
 * A placeholder for a page the frame's own plugin granted. Core and the
 * desktop app check the grant against the plugin id the shell knows for this
 * frame, so a frame can only show pages its own backend picked.
 */
function mountWebView(consumer: Consumer, id: unknown, web: unknown): boolean {
  if (!validId(id) || typeof web !== "string" || !GRANT.test(web)) {
    return false;
  }
  const existing = consumer.views.get(id);
  if (existing && existing.web !== web) return false;
  if (!existing && consumer.views.size >= MAX_VIEWS) return false;
  consumer.views.set(id, {
    id,
    listId: "",
    itemKey: "",
    props: {},
    placement: existing?.placement ?? {
      rect: EMPTY_RECT,
      clip: null,
      visible: false,
    },
    interactive: existing?.interactive ?? true,
    z: existing?.z ?? 0,
    covers: existing?.covers ?? [],
    drawn: true,
    el: existing?.el ?? null,
    control: null,
    web,
  });
  emitChange();
  return true;
}

/** A placeholder appeared. */
export function mountForeignView(owner: string, data: unknown): boolean {
  const consumer = consumers.get(owner);
  if (!consumer || !data || typeof data !== "object") return false;
  const { id, listId, itemKey, props, web } = data as Record<string, unknown>;
  if (web !== undefined) return mountWebView(consumer, id, web);
  if (!validId(id) || !validId(listId) || typeof itemKey !== "string") {
    return false;
  }
  const list = consumer.lists.get(listId);
  if (!list?.items.has(itemKey)) return false;
  if (!consumer.views.has(id) && consumer.views.size >= MAX_VIEWS) {
    return false;
  }
  const existing = consumer.views.get(id);
  if (
    existing &&
    (existing.web !== undefined ||
      existing.listId !== listId ||
      existing.itemKey !== itemKey)
  ) {
    return false;
  }
  const fit = list.items.get(itemKey)!.fit;
  consumer.views.set(id, {
    id,
    listId,
    itemKey,
    props: plainObject(props),
    placement: existing?.placement ?? {
      rect: EMPTY_RECT,
      clip: null,
      visible: false,
    },
    interactive: existing?.interactive ?? true,
    z: existing?.z ?? 0,
    covers: existing?.covers ?? [],
    drawn: existing?.drawn ?? fit !== "overlay",
    el: existing?.el ?? null,
    control: existing?.control ?? null,
  });
  emitChange();
  return true;
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function setForeignProps(owner: string, id: unknown, props: unknown) {
  const view =
    typeof id === "string" ? consumers.get(owner)?.views.get(id) : undefined;
  if (!view) return;
  view.props = plainObject(props);
  emitChange();
}

export function disposeForeignView(owner: string, id: unknown): void {
  const consumer = consumers.get(owner);
  if (!consumer || typeof id !== "string") return;
  if (consumer.views.delete(id)) emitChange();
}

/**
 * One batch of placeholder spots, sent once per animation frame:
 * `{ views: [{ id, rect, clip, visible, interactive, z, covers }], dragging }`.
 */
export function placeForeignViews(owner: string, data: unknown): void {
  const consumer = consumers.get(owner);
  if (!consumer || !data || typeof data !== "object") return;
  const batch = data as Record<string, unknown>;
  if (Array.isArray(batch.views)) {
    for (const raw of batch.views.slice(0, MAX_VIEWS)) {
      if (!raw || typeof raw !== "object") continue;
      const entry = raw as Record<string, unknown>;
      const view =
        typeof entry.id === "string" ? consumer.views.get(entry.id) : undefined;
      if (!view) continue;
      const rect = readRect(entry.rect);
      if (!rect) continue;
      view.placement = {
        rect,
        clip: entry.clip === null ? null : (readRect(entry.clip) ?? null),
        visible: entry.visible === true,
      };
      view.interactive = entry.interactive !== false;
      view.z =
        typeof entry.z === "number" && Number.isFinite(entry.z)
          ? Math.max(0, Math.min(1000, Math.round(entry.z)))
          : 0;
      view.covers = Array.isArray(entry.covers)
        ? entry.covers
            .slice(0, MAX_OCCLUDERS)
            .map(readRect)
            .filter((rect): rect is Rect => !!rect)
        : [];
      applyView(consumer, view);
    }
  }
  if (
    typeof batch.dragging === "boolean" &&
    batch.dragging !== consumer.dragging
  ) {
    consumer.dragging = batch.dragging;
    applyLayer(consumer);
    for (const view of consumer.views.values()) applyView(consumer, view);
  }
}

/** Focus moved onto a placeholder: hand it to the provider view. */
export function focusForeignView(owner: string, id: unknown, edge: unknown) {
  const view =
    typeof id === "string" ? consumers.get(owner)?.views.get(id) : undefined;
  if (!view?.control) return;
  view.control.focusEdge(edge === "last" ? "last" : "first");
}

/** A consumer frame closed or reloaded. */
export function dropForeignConsumer(owner: string): void {
  if (consumers.delete(owner)) emitChange();
}

/** Test seam. */
export function resetForeignViews(): void {
  consumers.clear();
  emitChange();
}

/** Test seam: the store as it stands. */
export function foreignStateFor(owner: string) {
  const consumer = consumers.get(owner);
  if (!consumer) return undefined;
  return {
    lists: [...consumer.lists.values()].map((list) => ({
      listId: list.listId,
      kind: list.kind,
      id: list.id,
      items: [...list.items.keys()],
    })),
    views: [...consumer.views.values()].map((view) => ({
      id: view.id,
      listId: view.listId,
      itemKey: view.itemKey,
      web: view.web,
      el: view.el,
    })),
  };
}

// Placement in the page.

function toRect(dom: DOMRect): Rect {
  return { x: dom.left, y: dom.top, width: dom.width, height: dom.height };
}

/** Shell boxes around the frame that clip what it shows. */
function clippingAncestors(iframe: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  let node = iframe.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node);
    const cuts = (value: string) => !!value && value !== "visible";
    if (
      cuts(style.overflow) ||
      cuts(style.overflowX) ||
      cuts(style.overflowY) ||
      (style.clipPath && style.clipPath !== "none")
    ) {
      out.push(node);
    }
    node = node.parentElement;
  }
  return out;
}

/** The highest z-index on the way up, so the layer sits just over the frame. */
function stackLevel(iframe: HTMLElement): number {
  let level = 0;
  let node: HTMLElement | null = iframe;
  while (node && node !== document.body) {
    const z = Number.parseInt(getComputedStyle(node).zIndex, 10);
    if (Number.isFinite(z)) level = Math.max(level, z);
    node = node.parentElement;
  }
  return level;
}

function frameShown(iframe: HTMLIFrameElement): boolean {
  if (!iframe.isConnected) return false;
  const check = (
    iframe as HTMLIFrameElement & {
      checkVisibility?: (options?: Record<string, boolean>) => boolean;
    }
  ).checkVisibility;
  return check
    ? check.call(iframe, { visibilityProperty: true, opacityProperty: true })
    : true;
}

function measure(consumer: Consumer): boolean {
  const { iframe } = consumer;
  if (consumer.ticks % 30 === 0) {
    consumer.ancestors = clippingAncestors(iframe);
  }
  consumer.ticks += 1;
  const frame = toRect(iframe.getBoundingClientRect());
  const box = visibleBox(
    frame,
    consumer.ancestors.map((node) => toRect(node.getBoundingClientRect())),
  );
  const shown = frameShown(iframe);
  const same =
    JSON.stringify(frame) === JSON.stringify(consumer.frame) &&
    JSON.stringify(box) === JSON.stringify(consumer.box) &&
    shown === consumer.shown;
  consumer.frame = frame;
  consumer.box = box;
  consumer.shown = shown;
  return !same;
}

function applyLayer(consumer: Consumer): void {
  const layer = consumer.layer;
  if (!layer) return;
  const { box } = consumer;
  layer.style.left = `${box.x}px`;
  layer.style.top = `${box.y}px`;
  layer.style.width = `${box.width}px`;
  layer.style.height = `${box.height}px`;
  layer.style.display = consumer.shown && !isEmpty(box) ? "block" : "none";
  layer.style.pointerEvents = "none";
  layer.dataset.dragging = consumer.dragging ? "1" : "";
  if (consumer.ticks % 30 === 1) {
    layer.style.zIndex = String(stackLevel(consumer.iframe) + 1);
  }
}

function applyView(consumer: Consumer, view: ForeignView): void {
  const el = view.el;
  if (!el) return;
  const fit = view.web
    ? "fill"
    : consumer.lists.get(view.listId)?.items.get(view.itemKey)?.fit;
  const out = placeView({
    frame: consumer.frame,
    box: consumer.box,
    frameShown: consumer.shown,
    placement: view.placement,
    occluders: view.covers,
    drawn: view.drawn,
  });
  el.style.left = `${out.left}px`;
  el.style.top = `${out.top}px`;
  el.style.width = fit === "inline" ? "" : `${out.width}px`;
  el.style.height =
    fit === "fill" || fit === "overlay" ? `${out.height}px` : "";
  el.style.clipPath = out.clipPath;
  el.style.visibility = out.hidden ? "hidden" : "visible";
  el.style.zIndex = String(view.z);
  el.style.pointerEvents =
    out.hidden || !view.interactive || consumer.dragging ? "none" : "auto";
  el.dataset.foreignHidden = out.hidden ? "1" : "";
  if (view.web) view.place = { rect: out.shownInPage, hidden: out.hidden };
}

let loop = 0;

function tick() {
  loop = 0;
  if (consumers.size === 0) return;
  let any = false;
  for (const consumer of consumers.values()) {
    if (consumer.views.size === 0) continue;
    any = true;
    const changed = measure(consumer);
    if (changed || consumer.dirty) {
      consumer.dirty = false;
      applyLayer(consumer);
      for (const view of consumer.views.values()) applyView(consumer, view);
    }
  }
  if (any) startLoop();
}

function startLoop() {
  if (loop || typeof requestAnimationFrame === "undefined") return;
  loop = requestAnimationFrame(tick);
}

/** Test seam: runs one placement pass now. */
export function runForeignPlacement(): void {
  if (loop) cancelAnimationFrame(loop);
  tick();
}

// Lists: run the shell's own hooks for each and send the parts.

function sendItems(consumer: Consumer, list: ForeignList, built: BuiltList) {
  const { items, entries, actions, strings } = built;
  list.items = entries;
  list.actions = actions;
  // A view whose part went away goes with it.
  let removed = false;
  for (const [id, view] of consumer.views) {
    if (view.listId === list.listId && !entries.has(view.itemKey)) {
      consumer.views.delete(id);
      removed = true;
    }
  }
  if (removed) emitChange();
  const payload = { listId: list.listId, items, strings };
  let json = "";
  try {
    json = JSON.stringify(payload);
  } catch {
    json = String(Math.random());
  }
  if (json === list.last) return;
  list.last = json;
  consumer.emit("foreign.items", payload);
}

function withHost(
  context: Record<string, unknown>,
  pluginId: string,
): Record<string, unknown> {
  if (context.hostId === undefined) return context;
  const host = scopedHost(context.hostId, pluginId);
  return host ? { ...context, host } : context;
}

const SlotRunner = memo(function SlotRunner({
  consumer,
  list,
}: {
  consumer: Consumer;
  list: ForeignList;
}) {
  const context = useMemo(
    () => withHost(list.context, consumer.pluginId),
    [list.context, consumer.pluginId],
  );
  const contributions = useActionSlot(list.id, context);
  useEffect(() => {
    sendItems(
      consumer,
      list,
      slotItems(contributions, resolveSlotFit(list.id)),
    );
  }, [consumer, list, contributions]);
  return null;
});

const ExtensionRunner = memo(function ExtensionRunner({
  consumer,
  list,
}: {
  consumer: Consumer;
  list: ForeignList;
}) {
  const extensions = useExtensions(list.id);
  useEffect(() => {
    // The consumer reads its own items in its frame.
    sendItems(consumer, list, extensionItems(extensions, consumer.pluginId));
  }, [consumer, list, extensions]);
  return null;
});

const ComponentRunner = memo(function ComponentRunner({
  consumer,
  list,
}: {
  consumer: Consumer;
  list: ForeignList;
}) {
  const component = usePluginComponent(list.id);
  useEffect(() => {
    sendItems(consumer, list, componentItems(list.id, component));
  }, [consumer, list, component]);
  return null;
});

// The layer.

function container(): HTMLElement {
  let node = document.getElementById("termix-foreign-views");
  if (!node) {
    node = document.createElement("div");
    node.id = "termix-foreign-views";
    document.body.appendChild(node);
  }
  return node;
}

function ForeignViewBox({
  consumer,
  view,
}: {
  consumer: Consumer;
  view: ForeignView;
}) {
  if (view.web) return <WebViewBox consumer={consumer} view={view} />;
  return <PartViewBox consumer={consumer} view={view} />;
}

function WebViewBox({
  consumer,
  view,
}: {
  consumer: Consumer;
  view: ForeignView;
}) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = box.current;
    view.el = node;
    applyView(consumer, view);
    return () => {
      if (view.el === node) view.el = null;
    };
  }, [consumer, view]);
  return (
    <div
      ref={box}
      data-foreign-view={consumer.pluginId}
      data-foreign-id={view.id}
      style={{ position: "absolute", visibility: "hidden", display: "flex" }}
    >
      <GrantedWebView
        pluginId={consumer.pluginId}
        grant={view.web!}
        placement={() => view.place ?? null}
      />
    </div>
  );
}

function PartViewBox({
  consumer,
  view,
}: {
  consumer: Consumer;
  view: ForeignView;
}) {
  const item = consumer.lists.get(view.listId)?.items.get(view.itemKey);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = box.current;
    view.el = node;
    applyView(consumer, view);
    return () => {
      if (view.el === node) view.el = null;
    };
  }, [consumer, view]);

  // view.props is replaced, never changed in place.
  const props = useMemo(
    () => (item ? scopeHostProps(view.props, item.pluginId) : {}),
    [item, view.props],
  );

  if (!item) return null;
  const meta = frameMetaOf(item.component);
  const onFrameEvent = (name: string, data: unknown) => {
    if (name === "size") {
      consumer.emit("foreign.size", { id: view.id, size: data });
    } else if (name === "drawn") {
      view.drawn = (data as { drawn?: unknown } | null)?.drawn === true;
      applyView(consumer, view);
    } else if (name === "focusOut") {
      const dir = (data as { dir?: unknown } | null)?.dir;
      consumer.emit("foreign.focusOut", {
        id: view.id,
        dir: dir === "prev" ? "prev" : "next",
      });
    } else if (name === "wheel") {
      const { dx, dy } = (data ?? {}) as { dx?: unknown; dy?: unknown };
      if (typeof dx !== "number" || typeof dy !== "number") return;
      const clamp = (n: number) => Math.max(-5000, Math.min(5000, n));
      consumer.emit("foreign.wheel", {
        id: view.id,
        dx: clamp(dx),
        dy: clamp(dy),
      });
    }
  };
  const Component = item.component;
  return (
    <div
      ref={box}
      data-foreign-view={item.pluginId}
      data-foreign-id={view.id}
      style={{ position: "absolute", visibility: "hidden", display: "flex" }}
    >
      {meta ? (
        <PluginFrameView
          pluginId={meta.pluginId}
          frameKey={meta.frameKey}
          fit={item.fit}
          edge
          props={meta.adapt ? meta.adapt(props) : props}
          onFrameEvent={onFrameEvent}
          controlRef={(control) => {
            view.control = control;
          }}
        />
      ) : (
        <div className="flex min-h-0 w-full flex-1 flex-col">
          <Component {...props} />
        </div>
      )}
    </div>
  );
}

function Layer({ consumer }: { consumer: Consumer }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    consumer.layer = node;
    consumer.dirty = true;
    consumer.ticks = 0;
    measure(consumer);
    applyLayer(consumer);
    startLoop();
    return () => {
      if (consumer.layer === node) consumer.layer = null;
    };
  }, [consumer]);
  return (
    <div
      ref={ref}
      data-foreign-layer={consumer.pluginId}
      style={{ position: "fixed", overflow: "hidden", display: "none" }}
    >
      {[...consumer.views.values()].map((view) => (
        <ForeignViewBox
          key={`${view.id}\u0000${view.listId}\u0000${view.itemKey}`}
          consumer={consumer}
          view={view}
        />
      ))}
    </div>
  );
}

/** Runs the lists and draws the layers. Mounted once, beside DataWatchHost. */
export function ForeignViewHost() {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  const list = [...consumers.values()];
  useEffect(() => {
    startLoop();
  });
  return (
    <>
      {list.flatMap((consumer) =>
        [...consumer.lists.values()].map((entry) => {
          const key = `${consumer.owner}\u0000${entry.listId}`;
          if (entry.kind === "slot") {
            return <SlotRunner key={key} consumer={consumer} list={entry} />;
          }
          if (entry.kind === "extension") {
            return (
              <ExtensionRunner key={key} consumer={consumer} list={entry} />
            );
          }
          return <ComponentRunner key={key} consumer={consumer} list={entry} />;
        }),
      )}
      {list.some((consumer) => consumer.views.size > 0) &&
        createPortal(
          list
            .filter((consumer) => consumer.views.size > 0)
            .map((consumer) => (
              <Layer key={consumer.owner} consumer={consumer} />
            )),
          container(),
        )}
    </>
  );
}
