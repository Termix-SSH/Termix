const { randomUUID } = require("node:crypto");

function createC2SAuthBridge(ipcMain, getWindow) {
  const pending = new Map();
  ipcMain.handle("answer-c2s-auth", (event, id, answer) => {
    const item = pending.get(id);
    if (!item || item.sender !== event.sender) return false;
    if (answer !== null && (typeof answer !== "string" || answer.length > 8192))
      return false;
    item.finish(answer);
    return true;
  });
  return function attach(ws, tunnelName) {
    const active = new Set();
    const close = () => {
      for (const id of active) pending.get(id)?.finish(null);
      ws.off("message", onMessage);
      ws.off("close", close);
      ws.off("error", close);
    };
    const onMessage = (raw, binary) => {
      if (binary) return;
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message.type !== "auth-prompt") return;
      const window = getWindow();
      if (
        !window ||
        window.isDestroyed() ||
        active.size ||
        typeof message.requestId !== "string" ||
        !["totp", "input", "browser"].includes(message.request?.kind) // plugin-id-ok: SSH prompt kind, not the plugin
      ) {
        ws.close();
        return;
      }
      const sender = window.webContents;
      const id = randomUUID();
      const finish = (answer) => {
        if (!pending.delete(id)) return;
        active.delete(id);
        clearTimeout(timer);
        sender.off("destroyed", cancelled);
        sender.off("did-start-loading", cancelled);
        if (!sender.isDestroyed())
          sender.send("c2s-auth-prompt", { id, closed: true });
        if (ws.readyState === 1)
          ws.send(
            JSON.stringify({
              type: "auth-response",
              requestId: message.requestId,
              answer,
            }),
          );
        if (answer === null) ws.close();
      };
      const cancelled = () => finish(null);
      const timer = setTimeout(cancelled, 60_000);
      active.add(id);
      pending.set(id, { sender, finish });
      sender.once("destroyed", cancelled);
      sender.once("did-start-loading", cancelled);
      sender.send("c2s-auth-prompt", {
        id,
        tunnelName,
        request: message.request,
      });
    };
    ws.on("message", onMessage);
    ws.once("close", close);
    ws.once("error", close);
  };
}
module.exports = { createC2SAuthBridge };
