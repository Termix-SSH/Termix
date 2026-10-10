import { useEffect, useState, type RefObject } from "react";

export const HIDDEN_ATTR = "data-search-hidden";
const HIGHLIGHT = "settings-search";
const BLOCK = ".bg-card, [data-setting-row]";

function matches(el: Element, needle: string) {
  return (el.textContent ?? "").toLowerCase().includes(needle);
}

/** Visible blocks with no other block above them inside root. */
function topBlocks(root: HTMLElement, blocks: Element[], selector: string) {
  return blocks.filter((el) => {
    let parent = el.parentElement;
    while (parent && parent !== root) {
      if (parent.matches(selector) || parent.classList.contains("hidden"))
        return false;
      parent = parent.parentElement;
    }
    return true;
  });
}

/**
 * Hides the cards and rows on a settings page that do not contain the query.
 * A card whose own text matches keeps every row; otherwise only its matching
 * rows stay. Returns how many cards are still showing.
 */
export function filterSettingsPage(
  root: HTMLElement,
  query: string,
  blockSelector: string = BLOCK,
): number {
  for (const el of root.querySelectorAll(`[${HIDDEN_ATTR}]`)) {
    el.removeAttribute(HIDDEN_ATTR);
  }
  const needle = query.trim().toLowerCase();
  const blocks = [...root.querySelectorAll(blockSelector)];
  const cards = topBlocks(root, blocks, blockSelector);
  if (!needle) return cards.length;

  let shown = 0;
  for (const card of cards) {
    if (!matches(card, needle)) {
      card.setAttribute(HIDDEN_ATTR, "");
      continue;
    }
    shown++;
    const rows = [...card.querySelectorAll("[data-setting-row]")].filter(
      (row) => row !== card,
    );
    if (!rows.some((row) => matches(row, needle))) continue;
    for (const row of rows) {
      if (!matches(row, needle)) row.setAttribute(HIDDEN_ATTR, "");
    }
    for (const inner of card.querySelectorAll(".bg-card")) {
      if (inner !== card && !matches(inner, needle)) {
        inner.setAttribute(HIDDEN_ATTR, "");
      }
    }
  }
  return shown;
}

type HighlightRegistry = Map<string, unknown>;

function highlights(): HighlightRegistry | undefined {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  return css?.highlights;
}

/** Marks every match with the CSS highlight API where the browser has it. */
function highlightMatches(root: HTMLElement, query: string) {
  const registry = highlights();
  const Highlight = (
    globalThis as { Highlight?: new (...r: Range[]) => unknown }
  ).Highlight;
  if (!registry || !Highlight) return;
  registry.delete(HIGHLIGHT);
  const needle = query.trim().toLowerCase();
  if (!needle) return;
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.toLowerCase() ?? "";
    let at = text.indexOf(needle);
    while (at !== -1) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
      at = text.indexOf(needle, at + needle.length);
    }
  }
  registry.set(HIGHLIGHT, new Highlight(...ranges));
}

/**
 * Keeps a settings page filtered while its content loads and changes.
 * Returns false when the query hides everything.
 */
export function useSettingsPageFilter(
  rootRef: RefObject<HTMLElement | null>,
  query: string,
  pageKey: string,
  blockSelector: string = BLOCK,
  onFiltered?: (root: HTMLElement) => void,
): boolean {
  const [anyShown, setAnyShown] = useState(true);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    const run = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setAnyShown(
          filterSettingsPage(root, query, blockSelector) > 0 || !query.trim(),
        );
        highlightMatches(root, query);
        onFiltered?.(root);
      });
    };
    run();
    if (!query.trim()) return () => cancelAnimationFrame(frame);
    const observer = new MutationObserver(run);
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      highlights()?.delete(HIGHLIGHT);
    };
  }, [rootRef, query, pageKey, blockSelector, onFiltered]);
  return anyShown;
}
