import path from "path";
import fs from "fs";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const sslCertPath = path.join(process.cwd(), "ssl/termix.crt");
const sslKeyPath = path.join(process.cwd(), "ssl/termix.key");

const hasSSL = fs.existsSync(sslCertPath) && fs.existsSync(sslKeyPath);
const useHTTPS = process.env.VITE_HTTPS === "true" && hasSSL;
const packageJson = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
) as { version?: string };

const manualChunkGroups: Record<string, string[]> = {
  "react-vendor": ["react", "react-dom"],
  "ui-vendor": [
    "@radix-ui/react-dialog",
    "@radix-ui/react-dropdown-menu",
    "@radix-ui/react-select",
    "@radix-ui/react-tabs",
    "@radix-ui/react-switch",
    "@radix-ui/react-tooltip",
    "@radix-ui/react-scroll-area",
    "@radix-ui/react-separator",
    "lucide-react",
    "clsx",
    "tailwind-merge",
    "class-variance-authority",
  ],
  monaco: ["@monaco-editor/react", "monaco-editor"],
  "terminal-vendor": [
    "@xterm/addon-clipboard",
    "@xterm/addon-fit",
    "@xterm/addon-unicode11",
    "@xterm/addon-web-links",
    "@xterm/xterm",
    "react-xtermjs",
  ],
  codemirror: [
    "@uiw/react-codemirror",
    "@codemirror/view",
    "@codemirror/state",
    "@codemirror/language",
    "@codemirror/commands",
    "@codemirror/search",
    "@codemirror/autocomplete",
    "@codemirror/theme-one-dark",
    "@uiw/codemirror-extensions-langs",
    "@uiw/codemirror-theme-github",
  ],
  "remote-desktop-vendor": ["guacamole-common-js"],
  "graph-vendor": ["cytoscape", "react-cytoscapejs"],
  "chart-vendor": ["recharts"],
  "file-preview-vendor": [
    "react-pdf",
    "pdfjs-dist",
    "react-photo-view",
    "react-h5-audio-player",
    "react-markdown",
    "react-syntax-highlighter",
    "remark-gfm",
  ],
};

function getManualChunk(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;

  const normalizedId = id.replaceAll("\\", "/");

  for (const [chunkName, packages] of Object.entries(manualChunkGroups)) {
    if (
      packages.some((packageName) =>
        normalizedId.includes(`/node_modules/${packageName}/`),
      )
    ) {
      return chunkName;
    }
  }

  return undefined;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(
      packageJson.version || "0.0.0",
    ),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base: process.env.VITE_BASE_PATH || "./",
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: getManualChunk,
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  server: {
    https: useHTTPS
      ? {
          cert: fs.readFileSync(sslCertPath),
          key: fs.readFileSync(sslKeyPath),
        }
      : false,
    port: 5173,
    host: "localhost",
  },
});
