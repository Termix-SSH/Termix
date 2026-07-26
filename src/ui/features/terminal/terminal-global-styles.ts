const style = document.createElement("style");
style.innerHTML = `
@font-face {
  font-family: 'Caskaydia Cove Nerd Font Mono';
  src: url('./fonts/CaskaydiaCoveNerdFontMono-Regular.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Caskaydia Cove Nerd Font Mono';
  src: url('./fonts/CaskaydiaCoveNerdFontMono-Bold.ttf') format('truetype');
  font-weight: bold;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Caskaydia Cove Nerd Font Mono';
  src: url('./fonts/CaskaydiaCoveNerdFontMono-Italic.ttf') format('truetype');
  font-weight: normal;
  font-style: italic;
  font-display: swap;
}

@font-face {
  font-family: 'Caskaydia Cove Nerd Font Mono';
  src: url('./fonts/CaskaydiaCoveNerdFontMono-BoldItalic.ttf') format('truetype');
  font-weight: bold;
  font-style: italic;
  font-display: swap;
}

.xterm .xterm-viewport::-webkit-scrollbar {
  width: 8px;
  background: transparent;
}
.xterm .xterm-viewport::-webkit-scrollbar-thumb {
  background: rgba(0,0,0,0.3);
  border-radius: 4px;
}
.xterm .xterm-viewport::-webkit-scrollbar-thumb:hover {
  background: rgba(0,0,0,0.5);
}
.xterm .xterm-viewport {
  scrollbar-width: thin;
  scrollbar-color: rgba(0,0,0,0.3) transparent;
  background-color: transparent !important;
}

.dark .xterm .xterm-viewport::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.3);
}
.dark .xterm .xterm-viewport::-webkit-scrollbar-thumb:hover {
  background: rgba(255,255,255,0.5);
}
.dark .xterm .xterm-viewport {
  scrollbar-color: rgba(255,255,255,0.3) transparent;
}

.xterm {
  font-feature-settings: "liga" 0, "calt" 0;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.xterm .xterm-screen {
  font-variant-ligatures: none;
}

.xterm .xterm-screen .xterm-char {
  font-feature-settings: "liga" 0, "calt" 0;
}
`;
document.head.appendChild(style);

// Canvas fillText() does not reliably trigger @font-face fetches on every
// browser engine (notably Android WebView) the way rendering real DOM text
// does. xterm.js draws glyphs to a <canvas>, so without an explicit load the
// terminal can keep painting the fallback font's tofu boxes even after
// document.fonts.ready resolves. Forcing the load here ensures the glyph
// data is actually fetched before the terminal renders with it.
export function ensureTerminalFontsLoaded(fontFamily: string): void {
  if (typeof document === "undefined" || !document.fonts) return;
  const specs = [
    `400 16px "${fontFamily}"`,
    `700 16px "${fontFamily}"`,
    `italic 400 16px "${fontFamily}"`,
    `italic 700 16px "${fontFamily}"`,
  ];
  for (const spec of specs) {
    document.fonts.load(spec).catch(() => {});
  }
}
