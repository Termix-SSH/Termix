/**
 * Host scripts: command builders and output parsers for Docker, Linux
 * metrics, systemd, the journal and OpenRC.
 *
 * Pure TypeScript with no Node or ssh2 imports, so the same code runs in a
 * plugin backend and in the mobile app. Run a script by sending it on stdin
 * to the command from `scriptShell()`.
 */
export * from "./text.js";
export * from "./shell.js";
export * from "./docker.js";
export * from "./metrics.js";
export * from "./systemd.js";
export * from "./journal.js";
export * from "./openrc.js";
