import type { WebSocket } from "ws";
import { collabRuntimeStore } from "./runtime-store.js";

const PRESENCE_HEARTBEAT_MS = 15_000;

export interface CollabRoomClient {
  ws: WebSocket;
  userId: string;
  username: string;
}

/**
 * Local WebSocket fan-out plus optional Redis pub/sub for multi-instance room
 * events and presence. The terminal WS server feeds subscribe/unsubscribe.
 */
class CollabRoomHub {
  private rooms = new Map<string, Set<CollabRoomClient>>();

  constructor() {
    collabRuntimeStore.onEvent((roomId, message) => {
      if (
        "type" in message &&
        typeof message.type === "string" &&
        message.type.startsWith("collab_internal_")
      ) {
        return;
      }
      this.broadcastLocal(roomId, message);
    });
    setInterval(() => {
      for (const roomId of this.rooms.keys()) void this.refreshPresence(roomId);
    }, PRESENCE_HEARTBEAT_MS).unref();
  }

  subscribe(roomId: string, client: CollabRoomClient): void {
    let clients = this.rooms.get(roomId);
    if (!clients) {
      clients = new Set();
      this.rooms.set(roomId, clients);
    }
    for (const existing of clients) {
      if (existing.ws === client.ws) return;
    }
    clients.add(client);
    void this.refreshPresence(roomId);
  }

  /** Drops the socket from one room, or from every room when roomId is omitted. */
  unsubscribe(ws: WebSocket, roomId?: string): void {
    for (const [id, clients] of this.rooms) {
      if (roomId && id !== roomId) continue;
      let removed = false;
      for (const client of clients) {
        if (client.ws === ws) {
          clients.delete(client);
          removed = true;
        }
      }
      if (clients.size === 0) this.rooms.delete(id);
      if (removed) void this.refreshPresence(id);
    }
  }

  broadcast(roomId: string, message: object): void {
    this.broadcastLocal(roomId, message);
    void collabRuntimeStore.publish(roomId, message);
  }

  async onlineUsers(
    roomId: string,
  ): Promise<Array<{ userId: string; username: string }>> {
    return collabRuntimeStore.onlineUsers(
      roomId,
      this.localOnlineUsers(roomId),
    );
  }

  private broadcastLocal(roomId: string, message: object): void {
    const clients = this.rooms.get(roomId);
    if (!clients) return;
    const payload = JSON.stringify(message);
    for (const client of clients) {
      if (client.ws.readyState !== client.ws.OPEN) continue;
      try {
        client.ws.send(payload);
      } catch {
        /* keep broadcasting to the rest */
      }
    }
  }

  private localOnlineUsers(
    roomId: string,
  ): Array<{ userId: string; username: string }> {
    const clients = this.rooms.get(roomId);
    if (!clients) return [];
    const seen = new Map<string, string>();
    for (const client of clients) {
      seen.set(client.userId, client.username);
    }
    return Array.from(seen, ([userId, username]) => ({ userId, username }));
  }

  private async refreshPresence(roomId: string): Promise<void> {
    const localUsers = this.localOnlineUsers(roomId);
    await collabRuntimeStore.updatePresence(roomId, localUsers);
    this.broadcast(roomId, {
      type: "collab_online",
      roomId,
      users: await this.onlineUsers(roomId),
    });
  }
}

export const collabRoomHub = new CollabRoomHub();
