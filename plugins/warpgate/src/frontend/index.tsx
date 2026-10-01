import type { TermixApp } from "@termix/plugin-sdk/frontend";

// The host setting is drawn by core's schema form and the sign-in dialog is
// the transports' own, so there is nothing to register.
export function activate(_app: TermixApp): void {}
