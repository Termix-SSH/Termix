import path from "path";
import fs from "fs";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import cors from "cors";
import { termixPluginHost } from "./scripts/vite-plugin-termix-plugins.mjs";
import { desktopMetaCsp } from "./src/backend/http/security-headers";

const sslCertPath = path.join(process.cwd(), "ssl/termix.crt");
const sslKeyPath = path.join(process.cwd(), "ssl/termix.key");

const hasSSL = fs.existsSync(sslCertPath) && fs.existsSync(sslKeyPath);
const useHTTPS = process.env.VITE_HTTPS === "true" && hasSSL;
// Everything rides the main backend on 30001, plugins included (under
// /plugin-api and /plugin-ws).
const apiProxyPorts = [30001];
const apiProxy = Object.fromEntries(
  apiProxyPorts.map((port) => [
    `/__termix_api/${port}`,
    {
      target: `http://127.0.0.1:${port}`,
      changeOrigin: true,
      ws: true,
      rewrite: (requestPath: string) =>
        requestPath.replace(new RegExp(`^/__termix_api/${port}`), ""),
      // A plugin frame's CSP names the address the browser used, which the
      // backend can't see behind this proxy.
      configure: (proxy: {
        on: (
          event: "proxyReq",
          handler: (
            proxyReq: { setHeader: (name: string, value: string) => void },
            req: { url?: string; headers: Record<string, unknown> },
          ) => void,
        ) => void;
      }) => {
        proxy.on("proxyReq", (proxyReq, req) => {
          if (!req.url?.includes("/plugin-assets/")) return;
          const host = req.headers.host;
          if (typeof host === "string") {
            proxyReq.setHeader("X-Forwarded-Host", host);
          }
          proxyReq.setHeader("X-Forwarded-Prefix", `/__termix_api/${port}`);
        });
      },
    },
  ]),
);
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
  codemirror: [
    "@uiw/react-codemirror",
    "@codemirror/view",
    "@codemirror/state",
    "@codemirror/language",
    "@codemirror/theme-one-dark",
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

// The SDK's browser entries resolve to source, so the shell and workspace
// plugins share one instance in dev and nobody waits on a stale SDK build.
const sdkFrontendEntry = path.resolve(
  __dirname,
  "./packages/plugin-sdk/src/frontend.ts",
);
const sdkUiEntry = path.resolve(__dirname, "./src/ui/plugin-host/sdk-ui.ts");

/**
 * Vite's own CORS runs before any plugin and refuses the "null" origin of a
 * sandboxed plugin frame, so it is off and this does the same job: local
 * origins as Vite allows them, plus a frame calling its own plugin through the
 * proxy (the backend checks the frame token there).
 */
function devCors() {
  const FRAME_ROUTE = /^\/__termix_api\/\d+\/plugin-api\/[a-z][a-z0-9-]*\//;
  // Vite's default for server.cors.
  const LOCAL_ORIGIN =
    /^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
  const local = cors({ origin: LOCAL_ORIGIN });
  const frame = cors({ origin: "null", maxAge: 600 });
  return {
    name: "termix-dev-cors",
    configureServer(server: {
      middlewares: { use: (handler: cors.CorsRequestHandler) => void };
    }) {
      server.middlewares.use((req, res, next) => {
        const isFrame =
          req.headers.origin === "null" && FRAME_ROUTE.test(req.url ?? "");
        (isFrame ? frame : local)(req, res, next);
      });
    },
  };
}

export default defineConfig({
  plugins: [
    devCors(),
    react(),
    tailwindcss(),
    svgr(),
    termixPluginHost({
      repoRoot: __dirname,
      sdkFrontendEntry,
      sdkUiEntry,
      metaCsp: desktopMetaCsp,
    }),
  ],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(
      packageJson.version || "0.0.0",
    ),
  },
  resolve: {
    alias: {
      "@termix-ssh/plugin-sdk/frontend": sdkFrontendEntry,
      "@termix-ssh/plugin-sdk/ui": sdkUiEntry,
      "@/types": path.resolve(__dirname, "./src/types"),
      "@": path.resolve(__dirname, "./src/ui"),
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
    cors: false,
    https: useHTTPS
      ? {
          cert: fs.readFileSync(sslCertPath),
          key: fs.readFileSync(sslKeyPath),
        }
      : false,
    port: 5173,
    host: "localhost",
    proxy: apiProxy,
  },
});
