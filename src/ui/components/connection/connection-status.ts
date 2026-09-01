import type { ConnectionStage } from "@/types/connection-log.ts";

export type ConnectionStatus =
  "connecting" | "connected" | "error" | "disconnected";

// Guacamole client states, per guacamole-common-js Guacamole.Client#STATE_*.
const GUAC_STATE_IDLE = 0;
const GUAC_STATE_CONNECTING = 1;
const GUAC_STATE_WAITING = 2;
const GUAC_STATE_CONNECTED = 3;
const GUAC_STATE_DISCONNECTING = 4;
const GUAC_STATE_DISCONNECTED = 5;

export function guacStateToStage(state: number): ConnectionStage {
  switch (state) {
    case GUAC_STATE_CONNECTING:
      return "guac_connecting";
    case GUAC_STATE_WAITING:
      return "guac_handshake";
    case GUAC_STATE_CONNECTED:
      return "guac_ready";
    case GUAC_STATE_DISCONNECTING:
    case GUAC_STATE_DISCONNECTED:
      return "guac_disconnected";
    case GUAC_STATE_IDLE:
    default:
      return "guac_connecting";
  }
}

export function guacStateToStatus(state: number): ConnectionStatus {
  switch (state) {
    case GUAC_STATE_CONNECTED:
      return "connected";
    case GUAC_STATE_DISCONNECTED:
      return "error";
    default:
      return "connecting";
  }
}
