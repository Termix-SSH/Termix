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
  type ComponentType,
} from "react";
import { createPortal } from "react-dom";
import { useActionSlot } from "@/hooks/use-action-slot";
import { useExtensions } from "../extension-registry";
import { usePluginComponent } from "../component-registry";
import { shell, shellHost } from "../shell-bridge";
import { HostTabEmbed } from "@/shell/HostTabEmbed";
import { getTabType } from "@/shell/tab-registry";
import { hostActionsFor, listHostActions } from "@/sidebar/host-contributions";

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
import {
  foreignAnchorOf,
  shellScrollBoxOf,
  subscribeForeignAnchors,
} from "./foreign-anchors";
import { GrantedWebView, type WebPlace } from "./granted-web-view";
import { resolveSlotFit } from "./slot-fit";
import {
  componentItems,
  tabItems,
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
  /** The layer sits next to the iframe and moves with it (foreign-anchors). */
  anchored: boolean;
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

// A layer's anchor coming or going redraws where the layers sit.
subscribeForeignAnchors(emitChange);

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
      // Fixed for the consumer's life, so its layer never has to move.
      anchored: !!foreignAnchorOf(iframe),
      frame: EMPTY_RECT,
      box: EMPTY_RECT,
      shown: false,
      ancestors: [],
      ticks: 0,
      dirty: true,
    };
    consumers.set(owner, consumer);
    watchForMoves();
    frameSizes?.observe(iframe);
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
  const consumer = consumers.get(owner);
  if (!consumer) return;
  frameSizes?.unobserve(consumer.iframe);
  consumers.delete(owner);
  emitChange();
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
  if (consumer.anchored) {
    // Sized by its anchor and clipped by the boxes around the frame itself.
    layer.style.display = consumer.shown ? "block" : "none";
    layer.style.pointerEvents = "none";
    layer.dataset.dragging = consumer.dragging ? "1" : "";
    return;
  }
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
  const input = {
    frame: consumer.frame,
    box: consumer.box,
    frameShown: consumer.shown,
    placement: view.placement,
    occluders: view.covers,
    drawn: view.drawn,
  };
  // An anchored layer is the frame's own box, so frame coords are layer
  // coords and the browser clips it with the frame.
  const local: Rect = {
    x: 0,
    y: 0,
    width: consumer.frame.width,
    height: consumer.frame.height,
  };
  const out = placeView(
    consumer.anchored ? { ...input, frame: local, box: local } : input,
  );
  el.style.left = `${out.left}px`;
  el.style.top = `${out.top}px`;
  el.style.width = fit === "inline" || fit === "bar" ? "" : `${out.width}px`;
  el.style.height =
    fit === "fill" || fit === "overlay" || fit === "bar"
      ? `${out.height}px`
      : "";
  el.style.clipPath = out.clipPath;
  el.style.visibility = out.hidden ? "hidden" : "visible";
  el.style.zIndex = String(view.z);
  el.style.pointerEvents =
    out.hidden || !view.interactive || consumer.dragging ? "none" : "auto";
  el.dataset.foreignHidden = out.hidden ? "1" : "";
  if (view.web) {
    // A native view needs where it shows in the page, whatever the layer.
    const page = consumer.anchored ? placeView(input) : out;
    view.place = { rect: page.shownInPage, hidden: page.hidden };
  }
}

let loop = 0;
/**
 * Measuring a frame forces layout, which is cheap in Chromium but costly in
 * Firefox, where frames share the page's thread. So it runs every frame only
 * for a moment after something changed, then checks a few times a second.
 */
const SETTLE_MS = 500;
const POLL_MS = 400;
let settleUntil = 0;
let slowTimer: ReturnType<typeof setTimeout> | null = null;
let watching = false;
let frameSizes: ResizeObserver | null = null;

function watchForMoves(): void {
  if (watching || typeof window === "undefined") return;
  watching = true;
  const kick = () => startLoop();
  window.addEventListener("resize", kick);
  window.addEventListener("scroll", kick, true);
  window.addEventListener("transitionrun", kick, true);
  window.addEventListener("transitionend", kick, true);
  window.addEventListener("pointerup", kick, true);
  window.addEventListener("keyup", kick, true);
  frameSizes =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(kick);
}

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
  if (!any) return;
  if (performance.now() < settleUntil) {
    loop = requestAnimationFrame(tick);
  } else if (!slowTimer) {
    slowTimer = setTimeout(() => {
      slowTimer = null;
      if (!loop) loop = requestAnimationFrame(tick);
    }, POLL_MS);
  }
}

function startLoop() {
  settleUntil = performance.now() + SETTLE_MS;
  watchForMoves();
  if (slowTimer) {
    clearTimeout(slowTimer);
    slowTimer = null;
  }
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

const embeddedTabs = new Map<string, ComponentType<Record<string, unknown>>>();

/**
 * A host's tab drawn in the shell for a frame that embeds it (a host page),
 * only while one of the host's actions opens that tab type.
 */
function embeddedTab(
  type: string,
  hostId: unknown,
): ComponentType<Record<string, unknown>> {
  const key = `${type}\u0000${String(hostId)}`;
  let component = embeddedTabs.get(key);
  if (!component) {
    const Embedded = ({ isVisible }: Record<string, unknown>) => {
      const host = shellHost(hostId as string | number | undefined);
      if (!host) return null;
      const allowed = hostActionsFor(listHostActions(), host).some(
        (action) => action.tabType === type,
      );
      if (!allowed) return null;
      return (
        <HostTabEmbed
          host={host}
          type={type}
          isVisible={isVisible !== false}
          shell={shell}
        />
      );
    };
    Embedded.displayName = `EmbeddedTab(${type})`;
    component = Embedded;
    embeddedTabs.set(key, component);
  }
  return component;
}

const TabRunner = memo(function TabRunner({
  consumer,
  list,
}: {
  consumer: Consumer;
  list: ForeignList;
}) {
  const hostId = list.context.hostId;
  useEffect(() => {
    const owner = getTabType(list.id)?.pluginId ?? "";
    sendItems(consumer, list, tabItems(owner, embeddedTab(list.id, hostId)));
  }, [consumer, list, hostId]);
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
  // A framed part says when it painted; anything else is ready once mounted.
  const item = consumer.lists.get(view.listId)?.items.get(view.itemKey);
  const readyOnMount = !!view.web || (!!item && !frameMetaOf(item.component));
  useEffect(() => {
    if (readyOnMount) consumer.emit("foreign.shown", { id: view.id });
  }, [consumer, view.id, readyOnMount]);
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
      style={{
        position: "absolute",
        visibility: "hidden",
        display: "flex",
        overflow: "hidden",
      }}
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
    } else if (name === "shown") {
      consumer.emit("foreign.shown", { id: view.id });
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
      // The shell scrolls this page, so the shell takes the wheel too.
      const scroller = shellScrollBoxOf(consumer.iframe);
      if (scroller) {
        scroller.scrollBy({ left: clamp(dx), top: clamp(dy) });
        return;
      }
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
      style={{
        position: "absolute",
        visibility: "hidden",
        display: "flex",
        overflow: "hidden",
      }}
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
      style={
        consumer.anchored
          ? {
              position: "absolute",
              inset: 0,
              overflow: "hidden",
              display: "none",
              zIndex: 1,
            }
          : { position: "fixed", overflow: "hidden", display: "none" }
      }
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
          if (entry.kind === "tab") {
            return <TabRunner key={key} consumer={consumer} list={entry} />;
          }
          return <ComponentRunner key={key} consumer={consumer} list={entry} />;
        }),
      )}
      {list.some((consumer) => consumer.views.size > 0 && !consumer.anchored) &&
        createPortal(
          list
            .filter((consumer) => consumer.views.size > 0 && !consumer.anchored)
            .map((consumer) => (
              <Layer key={consumer.owner} consumer={consumer} />
            )),
          container(),
        )}
      {list
        .filter((consumer) => consumer.views.size > 0 && consumer.anchored)
        .map((consumer) => {
          const anchor = foreignAnchorOf(consumer.iframe);
          return anchor
            ? createPortal(
                <Layer key={consumer.owner} consumer={consumer} />,
                anchor,
                consumer.owner,
              )
            : null;
        })}
    </>
  );
}
