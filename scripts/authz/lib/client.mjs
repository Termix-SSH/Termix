// HTTP and socket calls as one identity.
import WebSocket from "ws";

function authHeaders(identity) {
  const headers = {};
  if (identity?.token) headers.authorization = `Bearer ${identity.token}`;
  return headers;
}

function withQuery(url, query) {
  if (!query) return url;
  const target = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null)
      target.searchParams.set(key, String(value));
  }
  return target.toString();
}

export async function call(
  base,
  { method = "GET", path, identity, body, query, headers },
) {
  const url = withQuery(`${base}${path}`, {
    ...(identity?.query ?? {}),
    ...(query ?? {}),
  });
  const init = {
    method: method === "ALL" ? "GET" : method,
    headers: { ...authHeaders(identity), ...(headers ?? {}) },
    redirect: "manual",
  };
  if (body !== undefined && init.method !== "GET" && init.method !== "HEAD") {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      return {
        status: 0,
        error: String(error?.cause?.code ?? error?.name ?? error),
      };
    }
    // Rate limits are not an answer about access; wait and ask again.
    if (res.status === 429 && attempt < 6 && waited < 60) {
      await res.arrayBuffer().catch(() => {});
      const asked = Number(res.headers.get("retry-after")) || 2 ** attempt * 2;
      const wait = Math.min(asked, 60 - waited, 30);
      waited += wait;
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      continue;
    }
    const text = await res.text().catch(() => "");
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return {
      status: res.status,
      json,
      text: text.slice(0, 2000),
      setCookie: res.headers.getSetCookie?.() ?? [],
    };
  }
}

/** Calls and throws unless the status is 2xx. For seeding. */
export async function must(base, request) {
  const res = await call(base, request);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `${request.method ?? "GET"} ${request.path} as ${request.identity?.id ?? "anon"} gave ${res.status}: ${res.text?.slice(0, 300) ?? res.error}`,
    );
  }
  return res.json ?? {};
}

/**
 * Opens a socket and reports what happened in the first moments: refused at
 * upgrade (status), closed right after open (code), or still open. Optional
 * probe messages are sent once open; replies are collected.
 */
export function openSocket(
  base,
  { path, identity, query, send = [], waitMs = 1500 },
) {
  const url = withQuery(`${base.replace(/^http/, "ws")}${path}`, {
    ...(identity?.query ?? {}),
    ...(query ?? {}),
  });
  return new Promise((resolve) => {
    const messages = [];
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch {
        // Already gone.
      }
      resolve({ ...result, messages });
    };
    const ws = new WebSocket(url, {
      headers: authHeaders(identity),
      handshakeTimeout: 10_000,
    });
    const timer = setTimeout(() => done({ open: true }), waitMs + 10_000);
    ws.on("unexpected-response", (_req, res) => {
      res.resume();
      done({ open: false, status: res.statusCode });
    });
    ws.on("error", (error) =>
      done({ open: false, status: 0, error: String(error?.code ?? error) }),
    );
    ws.on("message", (data) => {
      const text = data.toString().slice(0, 2000);
      try {
        messages.push(JSON.parse(text));
      } catch {
        messages.push(text);
      }
    });
    ws.on("close", (code, reason) =>
      done({
        open: false,
        status: 101,
        closeCode: code,
        closeReason: reason.toString(),
      }),
    );
    ws.on("open", () => {
      for (const message of send) {
        ws.send(
          typeof message === "string" ? message : JSON.stringify(message),
        );
      }
      setTimeout(() => done({ open: true, status: 101 }), waitMs);
    });
  });
}
