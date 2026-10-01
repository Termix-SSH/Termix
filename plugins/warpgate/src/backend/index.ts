import type { PluginContext } from "@termix/plugin-sdk/backend";
import { detectWarpgateRound } from "./detect.js";
import { hostImportNormalizer } from "./host-import.js";

export const HANDLER_ID = "warpgate";

export async function activate(ctx: PluginContext) {
  ctx.auth.registerKeyboardInteractiveHandler({
    id: HANDLER_ID,
    label: "Warpgate",
    detect: (round) => detectWarpgateRound(round),
    // Warpgate asks for the password before its browser round; answer it
    // silently so the only thing the user sees is the sign-in dialog.
    autoAnswerPasswords: (_host, settings) => settings.useWarpgate === true,
  });

  ctx.registry.provide("warpgate.hostImportNormalizer", hostImportNormalizer);
}

export async function deactivate() {
  // Registered through ctx, so core removes it.
}
