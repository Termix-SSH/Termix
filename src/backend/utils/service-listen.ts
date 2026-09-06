import http from "http";
import type { RequestListener } from "http";
import type { Logger } from "./logger.js";

interface ServiceListenOptions {
  app: RequestListener;
  port: number;
  logger: Logger;
  /** Used only to identify the service in the conflict log. */
  serviceName: string;
  host?: string;
  onListening?: () => void;
}

/**
 * Starts one of the backend's fixed-port services.
 *
 * Express's `app.listen(port, host, callback)` registers that callback as
 * the server's `error` handler as well as its `listening` handler:
 *
 *   if (typeof args[args.length - 1] === 'function') {
 *     var done = args[args.length - 1] = once(args[args.length - 1])
 *     server.once('error', done)
 *   }
 *
 * so a port conflict called the service's "started" callback with an
 * EADDRINUSE error as its argument and emitted nothing. Since none of the
 * services read that argument, a failed bind was indistinguishable from a
 * successful one: the service logged that it had started, ran its
 * initialisation, and served nothing, with no error anywhere in the logs.
 *
 * Building the server here keeps `listening` and `error` separate. A port
 * conflict is treated the way database.ts already treats one on the main
 * HTTP port -- reported with the port that was taken, then exit -- rather
 * than leaving the backend up with one feature silently missing. Exiting
 * also gives the desktop app the classified failure it already knows how
 * to surface, so the user is told which port to free.
 */
/**
 * Reports a port conflict on an already-built service server and stops the
 * backend, for services that must own their `http.Server` (the tunnel
 * service attaches a WebSocket upgrade handler to it, for example) and so
 * cannot go through {@link listenOnServicePort}.
 */
export function attachServicePortConflictHandler(
  server: http.Server,
  port: number,
  logger: Logger,
  serviceName: string,
): void {
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.error(
        `Port ${port} is already in use. Kill the existing process and retry.`,
        err,
        {
          operation: "service_port_conflict",
          port,
          service: serviceName,
        },
      );
      // process.exit() does not return, so nothing below runs in
      // production; the explicit return keeps that obvious and keeps the
      // rethrow below reachable only for genuinely unexpected errors.
      process.exit(1);
      return;
    }
    throw err;
  });
}

export function listenOnServicePort({
  app,
  port,
  logger,
  serviceName,
  host = "127.0.0.1",
  onListening,
}: ServiceListenOptions): http.Server {
  const server = http.createServer(app);
  attachServicePortConflictHandler(server, port, logger, serviceName);
  server.listen(port, host, onListening);
  return server;
}
