import type { WebSocket } from "ws";

export interface CollabRoomClient {
  ws: WebSocket;
  userId: string;
  username: string;
}

/**
 * In-memory fan-out for collab room events, mirroring the single-instance
 * assumption TerminalSessionManager already makes. REST mutations broadcast
 * through it; the terminal WS server feeds subscribe/unsubscribe.
 */
class CollabRoomHub {
  private rooms = new Map<string, Set<CollabRoomClient>>();

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
    this.broadcastOnline(roomId);
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
      if (removed) this.broadcastOnline(id);
    }
  }

  broadcast(roomId: string, message: object): void {
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

  onlineUsers(roomId: string): Array<{ userId: string; username: string }> {
    const clients = this.rooms.get(roomId);
    if (!clients) return [];
    const seen = new Map<string, string>();
    for (const client of clients) {
      seen.set(client.userId, client.username);
    }
    return Array.from(seen, ([userId, username]) => ({ userId, username }));
  }

  private broadcastOnline(roomId: string): void {
    this.broadcast(roomId, {
      type: "collab_online",
      roomId,
      users: this.onlineUsers(roomId),
    });
  }
}

export const collabRoomHub = new CollabRoomHub();
