import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  GUAC_WS_PORT,
  getGuacSessionInfo,
  restartGuacServer,
  startGuacamoleService,
  stopGuacamoleService,
  tokenService,
} from "./guacamole-server.js";
import { router } from "./routes.js";
import {
  registerGuacamoleBridge,
  unregisterGuacamoleBridge,
} from "../../../../src/backend/database/routes/guacamole-dispatch.js";

export async function activate(ctx: PluginContext) {
  await startGuacamoleService();

  registerGuacamoleBridge({
    router,
    restart: restartGuacServer,
    createJoinToken: (guacamoleConnectionId: string, readOnly: boolean) =>
      tokenService.createJoinToken(guacamoleConnectionId, readOnly),
    getSessionInfo: getGuacSessionInfo,
  });

  ctx.log.info(`Remote Desktop listening on ${GUAC_WS_PORT ?? 30008}`);
}

export async function deactivate() {
  unregisterGuacamoleBridge();
  await stopGuacamoleService();
}
