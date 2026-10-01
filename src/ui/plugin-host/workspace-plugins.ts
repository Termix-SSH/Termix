/**
 * Plugin sources in this monorepo, for the Vite dev server.
 *
 * Empty everywhere except `vite dev`, where the termix-plugin-host Vite plugin
 * replaces this module with import.meta.glob calls over plugins/<id>/, so
 * plugin frontends load through Vite with HMR instead of from their built
 * bundles. A production build keeps it empty: plugins are separate bundles
 * served from /plugin-assets, never part of the shell's own build.
 */

type Loader = () => Promise<unknown>;

/** plugin id -> its src/frontend/index.tsx */
export const workspaceFrontends: Record<string, Loader> = {};

/** plugin id -> locale file ("en", "de_DE") -> JSON */
export const workspaceLocales: Record<string, Record<string, Loader>> = {};
