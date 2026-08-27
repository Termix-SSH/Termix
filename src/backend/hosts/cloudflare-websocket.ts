interface OpeningWebSocket {
  once(event: "open", listener: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  off(event: "open", listener: () => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
  terminate(): void;
}

export function waitForWebSocketOpen(
  socket: OpeningWebSocket,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("open", onOpen);
      socket.off("error", onError);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      socket.terminate();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      socket.terminate();
      reject(new Error("Cloudflare tunnel timeout"));
    }, timeoutMs);

    socket.once("open", onOpen);
    socket.once("error", onError);
  });
}
