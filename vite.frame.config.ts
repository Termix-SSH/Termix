// Builds the page plugin views run in (dist/frame). It carries its own copy
// of React, the SDK and the UI kit, shared with the plugin bundle through the
// same import map the shell uses.
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import { termixPluginHost } from "./scripts/vite-plugin-termix-plugins.mjs";

const sdkFrontendEntry = path.resolve(
  __dirname,
  "./packages/plugin-sdk/src/frontend.ts",
);
const sdkUiEntry = path.resolve(__dirname, "./src/ui/plugin-host/sdk-ui.ts");

/**
 * Core's CSS names the terminal fonts at /fonts/, outside a frame's asset
 * folder. The server maps _frame/fonts/ to the UI build's fonts, so the frame
 * CSS points there instead of shipping a second copy.
 */
function frameFonts() {
  return {
    name: "termix-frame-fonts",
    generateBundle(
      _options: unknown,
      bundle: Record<string, { type: string; source?: unknown }>,
    ) {
      for (const file of Object.values(bundle)) {
        if (file.type === "asset" && typeof file.source === "string") {
          file.source = file.source.replace(
            /url\((["']?)\/fonts\//g,
            "url($1../fonts/",
          );
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [
    frameFonts(),
    react(),
    tailwindcss(),
    svgr(),
    termixPluginHost({
      repoRoot: __dirname,
      sdkFrontendEntry,
      sdkUiEntry,
      htmlEntry: "frame.html",
    }),
  ],
  resolve: {
    alias: {
      "@termix-ssh/plugin-sdk/frontend": sdkFrontendEntry,
      "@termix-ssh/plugin-sdk/ui": sdkUiEntry,
      // Each frame loads only the icons it draws, not all of Lucide.
      "@/lib/plugin-icon": path.resolve(
        __dirname,
        "./src/ui/plugin-frame/frame-plugin-icon.tsx",
      ),
      "@/types": path.resolve(__dirname, "./src/types"),
      "@": path.resolve(__dirname, "./src/ui"),
    },
  },
  base: "./",
  publicDir: false,
  build: {
    outDir: "dist/frame",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        // Icons the runtime imports itself would each be a file, since the
        // icon loader can also ask for them. One file saves a frame dozens of
        // fetches; icons only a plugin asks for stay one file each.
        manualChunks(id, { getModuleInfo }) {
          if (!id.includes("lucide-react/dist/esm/icons/")) return undefined;
          return (getModuleInfo(id)?.importers.length ?? 0) > 0
            ? "frame-icons"
            : undefined;
        },
      },
    },
  },
});
