import type { PluginContext } from "@termix/plugin-sdk/backend";
import { isValidMac, sendMagicPacket } from "./magic-packet.js";

export interface WakeOnLanV1 {
  wake: (hostId: number) => Promise<void>;
}

export function createWakeOnLanService(ctx: PluginContext): WakeOnLanV1 {
  return {
    async wake(hostId: number): Promise<void> {
      const host = await ctx.hosts.get(hostId);
      if (!host) {
        throw new Error("Host not found");
      }

      const macAddress = await ctx.settings.getHost<string>(
        hostId,
        "macAddress",
      );
      if (!macAddress || !isValidMac(macAddress)) {
        throw new Error("No valid MAC address configured");
      }
      const broadcastAddress = await ctx.settings.getHost<string>(
        hostId,
        "broadcastAddress",
      );

      await ctx.capabilities.require("network:broadcast");
      await sendMagicPacket(macAddress, broadcastAddress || undefined);
      ctx.log.info(`Wake-on-LAN packet sent to host ${hostId}`);
    },
  };
}
