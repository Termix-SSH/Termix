import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
  },
  build: {
    outDir: "dist", // Output directory for the build
    rollupOptions: {
      // Use a relative path from the project root (adjusted to reflect Docker WORKDIR)
      input: 'index.html',
    },
  },
});