import type { Request, Response } from "express";

/**
 * Open event streams by user, so a new alert shows up in the browser the
 * moment it is stored instead of on the next poll.
 */
export function createAlertStream() {
  const clients = new Map<string, Set<Response>>();

  const write = (res: Response, event: string, data: unknown) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // The close handler removes it.
    }
  };

  return {
    open(req: Request, res: Response, userId: string, hello: unknown): void {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders?.();

      let set = clients.get(userId);
      if (!set) {
        set = new Set();
        clients.set(userId, set);
      }
      set.add(res);
      write(res, "unread", hello);

      const heartbeat = setInterval(() => {
        try {
          res.write(": keepalive\n\n");
        } catch {
          close();
        }
      }, 30_000);

      const close = () => {
        clearInterval(heartbeat);
        const current = clients.get(userId);
        current?.delete(res);
        if (current?.size === 0) clients.delete(userId);
      };
      req.on("close", close);
    },

    /** Users with at least one stream open. */
    users(): string[] {
      return [...clients.keys()];
    },

    publish(userId: string, event: string, data: unknown): void {
      for (const res of clients.get(userId) ?? []) write(res, event, data);
    },

    closeAll(): void {
      for (const set of clients.values()) {
        for (const res of set) {
          try {
            res.end();
          } catch {
            // Already gone.
          }
        }
      }
      clients.clear();
    },
  };
}

export type AlertStream = ReturnType<typeof createAlertStream>;
