// Pure rules: what each identity should get from one table entry, and how a
// response is read. No I/O, so the unit tests can cover every branch.

export const IDENTITIES = [
  "anon",
  "expired",
  "revoked",
  "pending",
  "setup",
  "noperm",
  "other",
  "share-connect",
  "share-view",
  "share-edit",
  "share-manage",
  "owner",
  "admin",
  "key-ops-read",
  "key-ops-run",
  "guest",
];

const KEY_SCOPES = {
  "key-ops-read": ["operations:read"],
  "key-ops-run": ["operations:run"],
};

const HOST_LEVELS = ["connect", "view", "edit", "manage"];
const SHARE_LEVEL = {
  "share-connect": "connect",
  "share-view": "view",
  "share-edit": "edit",
  "share-manage": "manage",
};

// Kinds that the owner can share with a level. Everything else is the
// owner's alone, so a share user is refused like any other user.
const SHAREABLE = {
  host: (level, min) =>
    HOST_LEVELS.indexOf(level) >= HOST_LEVELS.indexOf(min ?? "connect"),
  folder: (level, min) =>
    HOST_LEVELS.indexOf(level) >= HOST_LEVELS.indexOf(min ?? "connect"),
  // Credentials have use and manage; connect, view and edit shares are use.
  credential: (level, min) => (min ?? "use") === "use" || level === "manage",
};

/** Same rule as core's operations/key-scopes.ts keyScopeAllows. */
export function keyScopeAllows(scopes, method, path) {
  if (scopes === null) return true;
  const clean = path.split("?")[0];
  if (/^\/plugin-api\/[a-z0-9-]+\/mcp(\/|$)/.test(clean)) {
    return (
      scopes.includes("operations:read") || scopes.includes("operations:run")
    );
  }
  if (!/^\/operations(\/|$)/.test(clean)) return false;
  if (scopes.includes("operations:run")) return true;
  if (!scopes.includes("operations:read")) return false;
  return method === "GET" || /^\/operations\/[^/]+\/run$/.test(clean);
}

/** Whether a permission list grants one permission, wildcards included. */
export function grants(list, permission) {
  if (list.includes("*") || list.includes(permission)) return true;
  const parts = permission.split(".");
  for (let i = parts.length; i > 0; i--) {
    if (list.includes(`${parts.slice(0, i).join(".")}.*`)) return true;
  }
  return false;
}

/**
 * "allow", "refuse", "public" or "any" (not checked) for one identity.
 * entry: { access, permission, resource: { kind, min, admin }, allow: [], expect: {} }
 * memberPermissions: what the plain user role grants the test users.
 */
export function expectFor(
  entry,
  identity,
  method,
  path,
  memberPermissions = [],
) {
  const result = baseExpect(entry, identity, method, path, memberPermissions);
  if (result === "allow" && entry.allowed === "any") return "any";
  return result;
}

function baseExpect(entry, identity, method, path, memberPermissions) {
  const access = entry.access;
  const allowList = new Set(entry.allow ?? []);
  if (entry.expect && entry.expect[identity]) return entry.expect[identity];
  if (access === "public") return identity === "anon" ? "public" : "any";
  if (identity === "anon" || identity === "expired" || identity === "revoked")
    return "refuse";
  if (identity === "pending" || identity === "setup" || identity === "guest") {
    return allowList.has(identity) ? "allow" : "refuse";
  }
  if (identity in KEY_SCOPES) {
    if (!keyScopeAllows(KEY_SCOPES[identity], method, path)) return "refuse";
    // A key acts as the owner it belongs to.
    return baseExpect(entry, "owner", method, path, memberPermissions);
  }
  if (identity === "admin") {
    if (entry.resource && entry.resource.admin === undefined) return "any";
    if (entry.resource) return entry.resource.admin ? "allow" : "refuse";
    return "allow";
  }
  if (access === "admin") return "refuse";
  const needed = [entry.permission ?? []].flat();
  if (needed.some((permission) => !grants(memberPermissions, permission)))
    return "refuse";
  if (identity === "noperm") {
    if (entry.permission) return "refuse";
    return entry.resource ? "refuse" : "allow";
  }
  if (!entry.resource) return "allow";
  if (identity === "owner") return "allow";
  if (identity === "other") return "refuse";
  const level = SHARE_LEVEL[identity];
  const shareable = SHAREABLE[entry.resource.kind];
  if (!shareable) return "refuse";
  return shareable(level, entry.resource.min) ? "allow" : "refuse";
}

export const REFUSED = new Set([401, 403, 404]);

/** How an HTTP status reads against what was expected. */
export function judgeHttp(expected, status) {
  if (expected === "any") return { ok: true };
  if (expected === "public") {
    return status === 401 || status === 403 || status === 0
      ? {
          ok: false,
          why: `public route refused an anonymous caller (${status})`,
        }
      : { ok: true };
  }
  if (status === 0 || status === 429 || status === 503) {
    return { ok: false, why: `no answer about access (${status})` };
  }
  if (expected === "refuse") {
    if (REFUSED.has(status)) return { ok: true };
    if (status === 400 || status === 422) {
      return {
        ok: false,
        why: `${status}: the request never reached the check, give the entry a body`,
      };
    }
    return { ok: false, why: `expected refusal, got ${status}` };
  }
  if (REFUSED.has(status))
    return { ok: false, why: `expected access, got ${status}` };
  return { ok: true };
}

/**
 * How a socket attempt reads. Refused = upgrade refused, closed with a
 * refusal code, or a reply to the probe that matches refuseReply.
 */
export function socketRefused(
  result,
  refusalCodes = [1008, 4001, 4401, 4403, 4404],
  refuseReply,
) {
  if (!result.open && result.status !== 101) return true;
  if (result.closeCode !== undefined && refusalCodes.includes(result.closeCode))
    return true;
  if (refuseReply) {
    const pattern = new RegExp(refuseReply, "i");
    if (
      (result.messages ?? []).some((message) =>
        pattern.test(JSON.stringify(message)),
      )
    )
      return true;
  }
  return false;
}

export function judgeSocket(expected, result, refusalCodes, refuseReply) {
  if (expected === "any") return { ok: true };
  if (expected === "public") expected = "allow";
  if (result.status === 0 && result.error)
    return { ok: false, why: `socket error ${result.error}` };
  const refused = socketRefused(result, refusalCodes ?? undefined, refuseReply);
  if (expected === "refuse") {
    return refused
      ? { ok: true }
      : {
          ok: false,
          why: `expected refusal, socket ${describeSocket(result)}`,
        };
  }
  return refused
    ? { ok: false, why: `expected access, socket ${describeSocket(result)}` }
    : { ok: true };
}

export function describeSocket(result) {
  if (result.status !== 101) return `upgrade ${result.status}`;
  if (result.closeCode !== undefined)
    return `closed ${result.closeCode} ${result.closeReason ?? ""}`.trim();
  return "stayed open";
}

/** Reads before writes, deletes last, so a hole that writes shows on its own. */
export function methodOrder(method) {
  return (
    { GET: 0, ALL: 0, WS: 1, POST: 2, PUT: 2, PATCH: 2, DELETE: 3 }[method] ?? 2
  );
}

export function splitKey(key) {
  const space = key.indexOf(" ");
  return { method: key.slice(0, space), path: key.slice(space + 1) };
}

/** Whether an allowed cell is actually called: reads always, writes only when the entry says so. */
export function callsAllowed(entry, method) {
  if (entry.destructive) return false;
  if (method === "GET" || method === "WS") return true;
  return entry.callAllowed === true;
}

/** Fills :params from the entry, then fixtures by name. Unknown params get a dummy. */
export function fillPath(path, entry, fixtures) {
  const missing = [];
  const filled = path.replace(/:(\w+)\??/g, (_match, name) => {
    const source = entry.params?.[name] ?? defaultParamSource(name, entry);
    if (source === undefined) {
      missing.push(name);
      return "authz-missing";
    }
    if (typeof source === "number") return String(source);
    if (source.startsWith("=")) return encodeURIComponent(source.slice(1));
    const value = fixtures[source];
    if (value === undefined) {
      missing.push(`${name} (fixture ${source})`);
      return "authz-missing";
    }
    return encodeURIComponent(String(value));
  });
  return { path: filled.replace(/\/\*$/, "/authz"), missing };
}

function defaultParamSource(name, entry) {
  if (name === "hostId") return "host";
  if (name === "credentialId") return "credential";
  if (name === "pluginId") return "=authz";
  if (name === "protocol") return "=ssh";
  if (entry.resource && /^(id|.*Id)$/.test(name) && entry.resource.kind) {
    return entry.resource.fixture ?? entry.resource.kind;
  }
  return "=authz-x";
}
