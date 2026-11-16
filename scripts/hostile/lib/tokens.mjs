// Frame tokens and forged tokens, checked from outside the browser.
import crypto from "node:crypto";
import { call, must } from "../../authz/lib/client.mjs";

export async function frameToken(base, identity, pluginId) {
  const res = await must(base, {
    method: "POST",
    path: `/plugins/${pluginId}/frame-token`,
    identity,
  });
  return res.token;
}

function b64(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function forge(payload, { alg = "HS256", key } = {}) {
  const head = b64({ alg, typ: "JWT" });
  const body = b64(payload);
  if (alg === "none") return `${head}.${body}.`;
  const signature = crypto
    .createHmac("sha256", key ?? crypto.randomBytes(32))
    .update(`${head}.${body}`)
    .digest("base64url");
  return `${head}.${body}.${signature}`;
}

function payloadOf(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
}

const bearer = (token) => ({ id: "frame", token });
const got = (res) => res.status >= 200 && res.status < 300;

/** Mints the token the expiry check uses at the end of the run. */
export async function startExpiryProbe(world) {
  return {
    token: await frameToken(world.base, world.admin, "hostile-frame"),
    at: Date.now(),
  };
}

export async function runTokens(world, log) {
  const results = {};
  const own = await frameToken(world.base, world.admin, "hostile-frame");
  const claims = payloadOf(own);

  const ownCall = await call(world.base, {
    path: "/plugin-api/hostile-frame/ping",
    identity: bearer(own),
  });
  results["token.own-control"] = {
    worked: got(ownCall),
    detail: `own route gave ${ownCall.status}`,
  };

  const other = await call(world.base, {
    path: "/plugin-api/hostile-victim/ping",
    identity: bearer(own),
  });
  results["token.other-plugin"] = {
    worked: got(other),
    detail: `victim route gave ${other.status}`,
  };

  const coreRoute = await call(world.base, {
    path: "/users/me",
    identity: bearer(own),
  });
  results["token.core-route"] = {
    worked: got(coreRoute),
    detail: `/users/me gave ${coreRoute.status}`,
  };

  const none = await call(world.base, {
    path: "/users/me",
    identity: bearer(forge({ ...claims, purpose: undefined }, { alg: "none" })),
  });
  results["token.forged-none"] = {
    worked: got(none),
    detail: `alg none gave ${none.status}`,
  };

  const keyed = await call(world.base, {
    path: "/users/me",
    identity: bearer(forge({ ...claims, purpose: undefined })),
  });
  results["token.forged-key"] = {
    worked: got(keyed),
    detail: `random key gave ${keyed.status}`,
  };

  // A second session for the other user, ended before its frame token is used.
  const loginRes = await call(world.base, {
    method: "POST",
    path: "/users/login",
    body: { username: world.otherName, password: world.password },
  });
  const jwt = loginRes.setCookie
    .find((value) => value.startsWith("jwt="))
    ?.split(";")[0]
    .slice(4);
  if (!jwt) {
    results["token.after-logout"] = {
      worked: false,
      error: true,
      detail: `could not log in a second session (${loginRes.status})`,
    };
  } else {
    const identity = { id: "short", token: decodeURIComponent(jwt) };
    const token = await frameToken(world.base, identity, "hostile-frame");
    await must(world.base, { method: "POST", path: "/users/logout", identity });
    const after = await call(world.base, {
      path: "/plugin-api/hostile-frame/ping",
      identity: bearer(token),
    });
    results["token.after-logout"] = {
      worked: got(after),
      detail: `after logout gave ${after.status}`,
    };
  }
  log?.("token checks done");
  return results;
}

/** Waits until the probe token is past its 5 minutes, then uses it. */
export async function finishExpiryProbe(world, probe, log) {
  const due = probe.at + 5 * 60_000 + 15_000;
  const wait = due - Date.now();
  if (wait > 0) {
    log?.(`waiting ${Math.ceil(wait / 1000)}s for the frame token to expire`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  const res = await call(world.base, {
    path: "/plugin-api/hostile-frame/ping",
    identity: bearer(probe.token),
  });
  return {
    "token.expired": {
      worked: got(res),
      detail: `token from ${Math.round((Date.now() - probe.at) / 1000)}s ago gave ${res.status}`,
    },
  };
}
