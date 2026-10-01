import { fileURLToPath } from "node:url";

export const pluginDir = fileURLToPath(new URL("../..", import.meta.url));
