import { afterEach, vi } from "vitest";

// jsdom does not implement matchMedia; provide a minimal stub so hooks that
// read media queries (e.g. useIsMobile) can run. Individual tests override
// window.innerWidth / matchMedia as needed.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});
