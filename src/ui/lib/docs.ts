import DOCS_PAGES from "./docs-pages.json";

export const DOCS_URL = "https://docs.termix.site";

/**
 * Every core docs page the app links to. The docs site checks each one
 * exists, so add new links here rather than writing URLs inline.
 */
export type DocsPage = keyof typeof DOCS_PAGES;

/** Full URL of a core docs page. */
export function docsUrl(page: DocsPage = "home"): string {
  const path = DOCS_PAGES[page] ?? "";
  return path ? `${DOCS_URL}/${path}` : `${DOCS_URL}/`;
}

export { DOCS_PAGES };
