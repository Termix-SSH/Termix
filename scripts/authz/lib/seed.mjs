// Builds every identity and the shared resources through real routes.
import crypto from "node:crypto";
import { call, must } from "./client.mjs";
import { totpCode } from "./fake-ssh.mjs";

// Every name the owner creates starts with this, so a reply to another user
// can be searched for anything of the owner's.
export const OWNER_MARK = "authz-own-";
const OWN_FOLDER = `${OWNER_MARK}folder`;

export const PASSWORD = `Authz-${crypto.randomBytes(9).toString("base64url")}!`;

function jwtFrom(res) {
  const cookie = res.setCookie.find((value) => value.startsWith("jwt="));
  return cookie ? decodeURIComponent(cookie.split(";")[0].slice(4)) : null;
}

/**
 * A session share guest: the owner opens a terminal on the fake SSH host and
 * shares it read only by link. The guest holds only the link token. Returns a
 * closer for the owner's socket, which must stay open while the guest is used.
 */
export async function seedGuest(base, world, log) {
  const { default: WebSocket } = await import("ws");
  const url = `${base.replace(/^http/, "ws")}/plugin-ws/ssh-terminal/terminal`;
  const ws = new WebSocket(url, {
    headers: { authorization: `Bearer ${world.ids.owner.token}` },
  });
  const sessionId = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("terminal never made a session")),
      30_000,
    );
    ws.on("error", reject);
    ws.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message.type === "sessionCreated") {
        clearTimeout(timer);
        resolve(message.sessionId);
      }
      // The fake host's key is new; accept it the way the terminal UI does.
      if (message.type === "host_key_verification_required") {
        ws.send(
          JSON.stringify({
            type: "host_key_verification_response",
            data: { action: "accept" },
          }),
        );
      }
      if (message.type === "error") log?.(`terminal: ${message.message}`);
    });
    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "connectToHost",
          data: {
            cols: 80,
            rows: 24,
            hostConfig: {
              id: world.fixtures.host,
              ip: "127.0.0.1",
              port: world.sshPort,
              username: "authz",
            },
          },
        }),
      );
    });
  });
  world.fixtures.terminalSession = sessionId;
  const share = await must(base, {
    method: "POST",
    path: "/plugin-api/session-sharing/create",
    identity: world.ids.owner,
    body: {
      hostId: world.fixtures.host,
      sessionId,
      protocol: "ssh",
      shareType: "link",
      permissionLevel: "read-only",
    },
  });
  world.fixtures.shareLink = share.linkToken;
  world.ids.guest = { id: "guest", query: { shareToken: share.linkToken } };
  log?.("seeded a read only share guest");
  return () => ws.terminate();
}

function parsePermissions(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function login(base, username, password = PASSWORD) {
  const res = await call(base, {
    method: "POST",
    path: "/users/login",
    body: { username, password },
  });
  if (res.status !== 200) {
    throw new Error(`login ${username} gave ${res.status}: ${res.text}`);
  }
  return { token: jwtFrom(res), body: res.json };
}

/** First boot: the admin, every plugin on. The caller restarts after this. */
export async function seedFirstBoot(base, log) {
  await must(base, {
    method: "POST",
    path: "/users/create",
    body: { username: "authz-admin", password: PASSWORD },
  });
  const { token } = await login(base, "authz-admin");
  const admin = { id: "admin", token };
  const plugins = await must(base, { path: "/plugins", identity: admin });
  for (const plugin of plugins.filter((p) => !p.enabled)) {
    const res = await call(base, {
      method: "PATCH",
      path: `/plugins/${plugin.id}/state`,
      identity: admin,
      body: { enabled: true },
    });
    if (res.status !== 200)
      log?.(`could not turn on ${plugin.id}: ${res.status} ${res.text}`);
  }
}

async function setPolicy(base, admin, values) {
  await must(base, {
    method: "PUT",
    path: "/plugins/login-security/settings/admin",
    identity: admin,
    body: values,
  });
}

/**
 * Second boot: users, roles, resources, shares and every session state.
 * Returns { identities, users, fixtures }.
 */
export async function seedWorld(base, { ssh, log }) {
  const ids = {};
  const users = {};
  const fixtures = {};
  const world = { ids, users, fixtures };

  const adminLogin = await login(base, "authz-admin");
  ids.admin = { id: "admin", token: adminLogin.token };
  users.admin = adminLogin.body.userId;
  const admin = ids.admin;

  const names = {
    owner: "authz-owner",
    other: "authz-other",
    "share-connect": "authz-connect",
    "share-view": "authz-view",
    "share-edit": "authz-edit",
    "share-manage": "authz-manage",
    noperm: "authz-noperm",
    mfa: "authz-mfa",
    "setup-admin": "authz-setup",
  };
  for (const [key, username] of Object.entries(names)) {
    await must(base, {
      method: "POST",
      path: "/users/admin-create",
      identity: admin,
      body: { username, password: PASSWORD },
    });
    const session = await login(base, username);
    ids[key] = { id: key, token: session.token };
    users[key] = session.body.userId;
  }

  // The pending and setup identities are admins, so any route that lets them
  // through hands out the most.
  for (const key of ["mfa", "setup-admin"]) {
    await must(base, {
      method: "POST",
      path: "/users/make-admin",
      identity: admin,
      body: { username: names[key] },
    });
  }

  // noperm: the built in user role can't be taken away, so everyone else gets
  // its permissions through a copy and the user role itself is emptied.
  const roles = await must(base, { path: "/rbac/roles", identity: admin });
  const userRole = (roles.roles ?? roles).find((r) => r.name === "user");
  const userPermissions = parsePermissions(userRole.permissions);
  world.memberPermissions = userPermissions;
  const member = await must(base, {
    method: "POST",
    path: "/rbac/roles",
    identity: admin,
    body: {
      name: "authz-member",
      displayName: "Authz member",
      description: "Copy of user",
    },
  });
  fixtures.role = member.roleId;
  await must(base, {
    method: "PUT",
    path: `/rbac/roles/${member.roleId}`,
    identity: admin,
    body: { permissions: userPermissions },
  });
  for (const key of [
    "owner",
    "other",
    "share-connect",
    "share-view",
    "share-edit",
    "share-manage",
  ]) {
    await must(base, {
      method: "POST",
      path: `/rbac/users/${users[key]}/roles`,
      identity: admin,
      body: { roleId: member.roleId },
    });
  }
  await must(base, {
    method: "PUT",
    path: `/rbac/roles/${userRole.id}`,
    identity: admin,
    body: { permissions: [] },
  });

  // The owner's resources.
  const owner = ids.owner;
  const credential = await must(base, {
    method: "POST",
    path: "/credentials",
    identity: owner,
    body: {
      name: `${OWNER_MARK}cred`,
      authType: "password",
      username: ssh.username,
      password: ssh.password,
    },
  });
  fixtures.credential = credential.id;
  const host = await must(base, {
    method: "POST",
    path: "/host/db/host",
    identity: owner,
    body: {
      name: `${OWNER_MARK}host`,
      ip: "127.0.0.1",
      port: ssh.port,
      username: ssh.username,
      authType: "password",
      password: ssh.password,
      folder: OWN_FOLDER,
      enableTerminal: true,
      enableFileManager: true,
    },
  });
  fixtures.host = host.id;
  // A second host for plugins that need two, or a gate that would change
  // how the first one connects.
  const host2 = await must(base, {
    method: "POST",
    path: "/host/db/host",
    identity: owner,
    body: {
      name: `${OWNER_MARK}host2`,
      ip: "127.0.0.1",
      port: ssh.port,
      username: ssh.username,
      authType: "password",
      password: ssh.password,
    },
  });
  fixtures.host2 = host2.id;
  fixtures.folder = OWN_FOLDER;
  for (const [key, id] of Object.entries(users)) fixtures[`user:${key}`] = id;
  await must(base, {
    method: "PUT",
    path: "/host/folders/metadata",
    identity: owner,
    body: { name: OWN_FOLDER, color: "#888888" },
  });
  const folders = await must(base, { path: "/host/folders", identity: owner });
  const folderRow = (folders.folders ?? folders).find?.(
    (f) => (f.name ?? f) === OWN_FOLDER,
  );
  if (folderRow?.id !== undefined) fixtures.folderId = folderRow.id;
  else log?.(`no folder id in ${JSON.stringify(folders).slice(0, 300)}`);
  const catalog = await must(base, {
    path: "/operations/catalog",
    identity: owner,
  });
  const actions = catalog.actions ?? catalog;
  if (Array.isArray(actions) && actions[0]) fixtures.operation = actions[0].id;

  const levels = {
    "share-connect": "connect",
    "share-view": "view",
    "share-edit": "edit",
    "share-manage": "manage",
  };
  for (const [key, level] of Object.entries(levels)) {
    await must(base, {
      method: "POST",
      path: `/rbac/host/${fixtures.host}/share`,
      identity: owner,
      body: {
        targets: [{ type: "user", id: users[key] }],
        permissionLevel: level,
      },
    });
    await must(base, {
      method: "POST",
      path: `/rbac/credential/${fixtures.credential}/share`,
      identity: owner,
      body: {
        targets: [{ type: "user", id: users[key] }],
        permissionLevel: level === "manage" ? "manage" : "use",
      },
    });
  }

  // Every plugin feature on for the owner's host.
  const plugins = await must(base, { path: "/plugins", identity: admin });
  // Gates that change how every connect works go on the second host only.
  const SECOND_HOST_ONLY = new Set(["privileged"]);
  for (const plugin of plugins) {
    const host = plugin.contributes?.settings?.host;
    if (!host) continue;
    if (SECOND_HOST_ONLY.has(host.enableKey)) {
      const res = await call(base, {
        method: "PUT",
        path: `/plugins/${plugin.id}/settings/host/${fixtures.host2}`,
        identity: admin,
        body: { [host.enableKey]: true },
      });
      if (res.status !== 200)
        log?.(
          `host settings for ${plugin.id}: ${res.status} ${res.text?.slice(0, 200)}`,
        );
      continue;
    }
    const values = {};
    if (host.enableKey) values[host.enableKey] = true;
    for (const field of host.fields ?? []) {
      if (field.type === "boolean" && /^enable/i.test(field.key))
        values[field.key] = true;
    }
    if (Object.keys(values).length === 0) continue;
    const res = await call(base, {
      method: "PUT",
      path: `/plugins/${plugin.id}/settings/host/${fixtures.host}`,
      identity: owner,
      body: values,
    });
    if (res.status !== 200)
      log?.(
        `host settings for ${plugin.id}: ${res.status} ${res.text?.slice(0, 200)}`,
      );
  }

  // Ids of the owner's grants, tab, session and an operation run.
  const hostAccess = await must(base, {
    path: `/rbac/host/${fixtures.host}/access`,
    identity: owner,
  });
  fixtures.hostAccess = hostAccess.accessList.find(
    (row) => row.userId === users["share-connect"],
  ).id;
  const credentialAccess = await must(base, {
    path: `/rbac/credential/${fixtures.credential}/access`,
    identity: owner,
  });
  fixtures.credentialAccess = credentialAccess.access.find(
    (row) => row.userId === users["share-connect"],
  ).id;
  await must(base, {
    method: "POST",
    path: "/rbac/folder/share",
    identity: owner,
    body: {
      folder: OWN_FOLDER,
      targets: [{ type: "user", id: users["share-connect"] }],
      permissionLevel: "connect",
    },
  });
  const folderAccess = await must(base, {
    path: "/rbac/folder/access",
    identity: owner,
    query: { folder: OWN_FOLDER },
  });
  const folderGrant = folderAccess.rules[0];
  if (folderGrant?.id !== undefined) fixtures.folderAccess = folderGrant.id;
  else
    log?.(`no folder grant in ${JSON.stringify(folderAccess).slice(0, 300)}`);
  await must(base, {
    method: "POST",
    path: "/open-tabs",
    identity: owner,
    body: { id: "authz-tab", tabType: "terminal", label: "authz", tabOrder: 0 },
  });
  fixtures.openTab = "authz-tab";
  const sessions = await must(base, {
    path: "/users/sessions",
    identity: owner,
  });
  fixtures.ownerSession = sessions.sessions.find((s) => s.isCurrentSession).id;
  const run = await call(base, {
    method: "POST",
    path: "/operations/alerts.unread/run",
    identity: owner,
    body: { input: {} },
  });
  const runId = run.json?.run?.id ?? run.json?.runId ?? run.json?.id;
  if (runId) fixtures.run = runId;
  else log?.(`no run id from ${run.status} ${run.text?.slice(0, 300)}`);

  // Scoped API keys for the owner.
  for (const [key, scopes] of [
    ["key-ops-read", ["operations:read"]],
    ["key-ops-run", ["operations:run"]],
  ]) {
    const created = await must(base, {
      method: "POST",
      path: "/users/api-keys",
      identity: admin,
      body: { name: key, userId: users.owner, scopes },
    });
    ids[key] = {
      id: key,
      token: created.token ?? created.key ?? created.apiKey,
    };
  }

  // Pending: TOTP on for the mfa admin, password step only.
  const setup = await must(base, {
    method: "POST",
    path: "/plugin-api/totp/setup",
    identity: ids.mfa,
  });
  await must(base, {
    method: "POST",
    path: "/plugin-api/totp/enable",
    identity: ids.mfa,
    body: { totp_code: totpCode(setup.secret) },
  });
  const pending = await login(base, names.mfa);
  if (!pending.body.temp_token)
    throw new Error("mfa login did not stop for the second factor");
  ids.pending = { id: "pending", token: pending.body.temp_token };

  // Setup: a second factor is required and the setup admin has none.
  await setPolicy(base, admin, { secondFactor: "always" });
  const restricted = await login(base, names["setup-admin"]);
  await setPolicy(base, admin, { secondFactor: "off" });
  if (!restricted.token) throw new Error("setup login gave no session");
  ids.setup = { id: "setup", token: restricted.token };

  // Revoked: a second owner session, logged out.
  const revoked = await login(base, names.owner);
  await must(base, {
    method: "POST",
    path: "/users/logout",
    identity: { token: revoked.token },
  });
  ids.revoked = { id: "revoked", token: revoked.token };

  // Expired: an owner session with a one minute idle limit, left idle.
  await setPolicy(base, admin, { idleTimeoutMinutes: 1 });
  const expired = await login(base, names.owner);
  await setPolicy(base, admin, { idleTimeoutMinutes: 0 });
  ids.expired = {
    id: "expired",
    token: expired.token,
    readyAt: Date.now() + 70_000,
  };

  ids.anon = { id: "anon" };
  log?.(`seeded ${Object.keys(ids).length} identities`);
  world.names = names;
  return world;
}
