import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import ssh2 from "ssh2";
import { createMockCtx } from "@termix/plugin-sdk/testing";
import { ed25519RawFromLine } from "../../src/backend/certificate.js";
import { manifest, startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

function ed25519Line(comment = "") {
  const pair = ssh2.utils.generateKeyPairSync("ed25519");
  const parsed = ssh2.utils.parseKey(pair.public);
  const key = Array.isArray(parsed) ? parsed[0] : parsed;
  if (key instanceof Error) throw key;
  const line = `${key.type} ${key.getPublicSSH().toString("base64")}`;
  return comment ? `${line} ${comment}` : line;
}

/** Checks an OpenSSH user certificate's signature against a CA public key. */
function certificateVerifies(certLine: string, caPublicLine: string): boolean {
  const blob = Buffer.from(certLine.split(" ")[1], "base64");
  let offset = 0;
  const skipString = () => {
    offset += 4 + blob.readUInt32BE(offset);
  };
  // type, nonce, key, serial, cert type, key id, principals, valid after,
  // valid before, critical options, extensions, reserved, signature key.
  skipString();
  skipString();
  skipString();
  offset += 8 + 4;
  skipString();
  skipString();
  offset += 8 + 8;
  skipString();
  skipString();
  skipString();
  skipString();
  const body = blob.subarray(0, offset);
  const signature = blob.subarray(offset + 4);
  const typeLength = signature.readUInt32BE(0);
  const rawLength = signature.readUInt32BE(4 + typeLength);
  const raw = signature.subarray(8 + typeLength, 8 + typeLength + rawLength);
  const caRaw = ed25519RawFromLine(caPublicLine)!;
  const publicKey = crypto.createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: caRaw.toString("base64url") },
    format: "jwk",
  });
  return crypto.verify(null, body, publicKey, raw);
}

async function claim(handle = "alice", user = "user-1") {
  const response = await server!.request("POST", "/", {
    user,
    body: { handle, description: "me" },
  });
  expect(response.status).toBe(201);
  return response.body;
}

describe("identity", () => {
  it("claims, checks, renames and deletes a handle", async () => {
    server = await startServer();

    expect((await server.request("GET", "/me")).body).toEqual({
      identity: null,
      keys: [],
    });
    expect((await server.request("GET", "/check/alice")).body).toEqual({
      available: true,
      valid: true,
    });
    expect((await server.request("GET", "/check/me")).body.valid).toBe(false);
    expect((await server.request("GET", "/check/Bad!")).body.valid).toBe(false);

    await claim("Alice");
    const me = (await server.request("GET", "/me")).body;
    expect(me.identity.handle).toBe("alice");
    expect(me.identity.resolverPath).toBe(
      "/plugin-api/termix-identity/u/alice",
    );
    expect(me.identity.resolverUrl).toBe(
      "https://termix.test/plugin-api/termix-identity/u/alice",
    );
    expect((await server.request("GET", "/check/alice")).body.available).toBe(
      false,
    );

    const renamed = await server.request("PUT", "/", {
      body: { handle: "alice2" },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.handle).toBe("alice2");

    expect((await server.request("DELETE", "/")).status).toBe(200);
    expect((await server.request("GET", "/me")).body.identity).toBeNull();
    expect(server.mock.audits.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        "create_termix_id",
        "update_termix_id",
        "delete_termix_id",
      ]),
    );
  });

  it("refuses a second handle, a taken one and an invalid one", async () => {
    server = await startServer();
    await claim("alice");

    const again = await server.request("POST", "/", {
      body: { handle: "bob" },
    });
    expect(again.status).toBe(409);

    const taken = await server.request("POST", "/", {
      user: "user-2",
      body: { handle: "alice" },
    });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toBe("Handle already taken");

    const invalid = await server.request("POST", "/", {
      user: "user-2",
      body: { handle: "-x" },
    });
    expect(invalid.status).toBe(400);
  });

  it("deletes the keys and CA with the identity", async () => {
    server = await startServer();
    await claim();
    await server.request("POST", "/keys", {
      body: { publicKey: ed25519Line() },
    });
    await server.request("POST", "/ca", { body: {} });

    await server.request("DELETE", "/");

    const count = (table: string) =>
      (
        server!.db.sqlite
          .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
          .get() as { n: number }
      ).n;
    expect(count("p_termix_identity_keys")).toBe(0);
    expect(count("p_termix_identity_ca")).toBe(0);
  });
});

describe("key publishing", () => {
  it("publishes a pasted key and serves it from the public resolver", async () => {
    server = await startServer();
    await claim();
    const line = ed25519Line("laptop");

    const added = await server.request("POST", "/keys", {
      body: { publicKey: line, label: "Laptop" },
    });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({
      algorithm: "ED25519",
      keyType: "ssh-ed25519",
      label: "Laptop",
      comment: "laptop",
      source: "manual",
      enabled: true,
    });

    const duplicate = await server.request("POST", "/keys", {
      body: { publicKey: line },
    });
    expect(duplicate.status).toBe(409);

    const resolved = await server.request("GET", "/u/alice", { user: null });
    expect(resolved.status).toBe(200);
    expect(resolved.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(resolved.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(resolved.text).toBe(
      `${line.split(" ").slice(0, 2).join(" ")} #termix-id @alice\n`,
    );
  });

  it("rejects something that is not a public key", async () => {
    server = await startServer();
    await claim();
    const response = await server.request("POST", "/keys", {
      body: { publicKey: "not a key" },
    });
    expect(response.status).toBe(400);
  });

  it("needs a handle before a key", async () => {
    server = await startServer();
    const response = await server.request("POST", "/keys", {
      body: { publicKey: ed25519Line() },
    });
    expect(response.status).toBe(400);
  });

  it("filters by algorithm and hides disabled keys", async () => {
    server = await startServer();
    await claim();
    const ed = await server.request("POST", "/keys", {
      body: { publicKey: ed25519Line() },
    });
    const rsa = ssh2.utils.generateKeyPairSync("rsa", { bits: 2048 });
    await server.request("POST", "/keys", { body: { publicKey: rsa.public } });

    const onlyEd = await server.request("GET", "/u/alice/ED25519", {
      user: null,
    });
    expect(onlyEd.text.trim().split("\n")).toHaveLength(1);
    expect(onlyEd.text).toContain("ssh-ed25519");

    const all = await server.request("GET", "/u/alice", { user: null });
    expect(all.text.trim().split("\n")).toHaveLength(2);

    const disabled = await server.request("PATCH", `/keys/${ed.body.id}`, {
      body: { enabled: false },
    });
    expect(disabled.body.enabled).toBe(false);
    const after = await server.request("GET", "/u/alice", { user: null });
    expect(after.text).not.toContain("ssh-ed25519");
  });

  it("serves an HTML viewer to browsers without an em dash", async () => {
    server = await startServer();
    await claim();
    const page = await server.request("GET", "/u/alice", {
      user: null,
      headers: { accept: "text/html" },
    });
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.text).toContain(
      "curl -fsSL https://termix.test/plugin-api/termix-identity/u/alice",
    );
    expect(page.text).not.toContain("—");
  });

  it("answers 404 for an unknown handle", async () => {
    server = await startServer();
    expect(
      (await server.request("GET", "/u/nobody", { user: null })).status,
    ).toBe(404);
  });

  it("imports the public half of a saved key credential", async () => {
    const line = ed25519Line();
    server = await startServer({
      sshKeyCredentials: [
        { id: 5, name: "Work key", username: "root", publicKey: line },
        { id: 6, name: "Broken", username: null, publicKey: null },
      ],
    });
    await claim();

    const listed = await server.request("GET", "/credentials");
    expect(listed.body.credentials).toEqual([
      { id: 5, name: "Work key" },
      { id: 6, name: "Broken" },
    ]);

    const imported = await server.request("POST", "/keys", {
      body: { credentialId: 5 },
    });
    expect(imported.status).toBe(201);
    expect(imported.body).toMatchObject({
      source: "credential",
      credentialId: 5,
      label: "Work key",
    });
    expect((await server.request("GET", "/linked-credentials")).body).toEqual({
      credentialIds: [5],
    });

    expect(
      (await server.request("POST", "/keys", { body: { credentialId: 6 } }))
        .status,
    ).toBe(400);
    expect(
      (await server.request("POST", "/keys", { body: { credentialId: 99 } }))
        .status,
    ).toBe(404);
  });

  it("generates a key pair, saves it as a credential and returns the private key once", async () => {
    server = await startServer();
    await claim();

    const generated = await server.request("POST", "/keys/generate", {
      body: { type: "ed25519" },
    });
    expect(generated.status).toBe(201);
    expect(generated.body.privateKey).toContain("PRIVATE KEY");
    expect(generated.body.credentialId).toBe(1);
    expect(server.mock.createdSshKeys).toHaveLength(1);
    expect(server.mock.createdSshKeys[0]).toMatchObject({
      name: "Termix ID @alice (ED25519)",
      publicKey: generated.body.publicKey,
      keyType: "ssh-ed25519",
    });

    const stored = server.db.sqlite
      .prepare("SELECT * FROM p_termix_identity_keys")
      .all() as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(1);
    expect(stored[0].credential_id).toBe(1);
    expect(JSON.stringify(stored)).not.toContain("PRIVATE KEY");
  });

  it("generates without saving when asked", async () => {
    server = await startServer();
    await claim();
    const generated = await server.request("POST", "/keys/generate", {
      body: { saveCredential: false },
    });
    expect(generated.status).toBe(201);
    expect(generated.body.credentialId).toBeNull();
    expect(server.mock.createdSshKeys).toHaveLength(0);
  });

  it("removes the published key when saving the credential fails", async () => {
    server = await startServer({
      capabilities: manifest.capabilities.filter(
        (capability) => capability !== "credentials:write",
      ),
    });
    await claim();
    const generated = await server.request("POST", "/keys/generate", {
      body: {},
    });
    expect(generated.status).toBe(500);
    expect((await server.request("GET", "/me")).body.keys).toEqual([]);
  });

  it("only touches the caller's own keys", async () => {
    server = await startServer();
    await claim();
    const key = await server.request("POST", "/keys", {
      body: { publicKey: ed25519Line() },
    });
    expect(
      (
        await server.request("DELETE", `/keys/${key.body.id}`, {
          user: "user-2",
        })
      ).status,
    ).toBe(404);
    expect(
      (await server.request("DELETE", `/keys/${key.body.id}`)).status,
    ).toBe(200);
  });
});

describe("certificate authority", () => {
  it("creates a CA, stores its key sealed and publishes the public key", async () => {
    server = await startServer();
    await claim();

    const created = await server.request("POST", "/ca", {
      body: { validityDays: 30 },
    });
    expect(created.status).toBe(201);
    expect(created.body.validityDays).toBe(30);
    expect(created.body.resolverUrl).toBe(
      "https://termix.test/plugin-api/termix-identity/u/alice/ca",
    );

    const row = server.db.sqlite
      .prepare("SELECT private_key FROM p_termix_identity_ca")
      .get() as { private_key: string };
    expect(row.private_key).not.toContain("PRIVATE KEY");
    expect(await server.mock.ctx.secrets.unseal(row.private_key)).toContain(
      "PRIVATE KEY",
    );

    const published = await server.request("GET", "/u/alice/ca", {
      user: null,
    });
    expect(published.status).toBe(200);
    expect(published.text).toBe(
      `${created.body.publicKey} termix-id-ca@alice\n`,
    );
    expect((await server.request("POST", "/ca", { body: {} })).status).toBe(
      409,
    );
  });

  it("issues a certificate the CA signed, with the principals asked for", async () => {
    server = await startServer();
    await claim();
    const ca = (await server.request("POST", "/ca", { body: {} })).body;
    const key = await server.request("POST", "/keys", {
      body: { publicKey: ed25519Line() },
    });

    const issued = await server.request(
      "POST",
      `/keys/${key.body.id}/certificate`,
      { body: { principals: ["root", " deploy ", ""], validityDays: 2 } },
    );
    expect(issued.status).toBe(200);
    expect(issued.body.principals).toEqual(["root", "deploy"]);
    expect(issued.body.validityDays).toBe(2);
    expect(issued.body.keyId).toBe(`termix:@alice:${key.body.id}`);
    expect(issued.body.certificate).toMatch(
      /^ssh-ed25519-cert-v01@openssh.com /,
    );
    const now = Math.floor(Date.now() / 1000);
    expect(issued.body.validBefore).toBeGreaterThan(now + 86400);
    expect(issued.body.validBefore).toBeLessThanOrEqual(now + 2 * 86400 + 5);
    expect(certificateVerifies(issued.body.certificate, ca.publicKey)).toBe(
      true,
    );
    expect(server.mock.audits.map((entry) => entry.action)).toContain(
      "issue_termix_id_certificate",
    );
  });

  it("refuses a certificate without a CA or for a non-Ed25519 key", async () => {
    server = await startServer();
    await claim();
    const ed = await server.request("POST", "/keys", {
      body: { publicKey: ed25519Line() },
    });
    expect(
      (
        await server.request("POST", `/keys/${ed.body.id}/certificate`, {
          body: {},
        })
      ).status,
    ).toBe(400);

    await server.request("POST", "/ca", { body: {} });
    const rsa = ssh2.utils.generateKeyPairSync("rsa", { bits: 2048 });
    const rsaKey = await server.request("POST", "/keys", {
      body: { publicKey: rsa.public },
    });
    expect(
      (
        await server.request("POST", `/keys/${rsaKey.body.id}/certificate`, {
          body: {},
        })
      ).status,
    ).toBe(400);
  });

  it("rotation replaces the key, so old certificates stop verifying", async () => {
    server = await startServer();
    await claim();
    const first = (await server.request("POST", "/ca", { body: {} })).body;
    const key = await server.request("POST", "/keys", {
      body: { publicKey: ed25519Line() },
    });
    const oldCert = (
      await server.request("POST", `/keys/${key.body.id}/certificate`, {
        body: {},
      })
    ).body.certificate;

    const rotated = await server.request("POST", "/ca/rotate", {
      body: { validityDays: 7 },
    });
    expect(rotated.status).toBe(200);
    expect(rotated.body.publicKey).not.toBe(first.publicKey);
    expect(rotated.body.validityDays).toBe(7);

    const published = (
      await server.request("GET", "/u/alice/ca", { user: null })
    ).text;
    expect(published).toContain(rotated.body.publicKey);
    expect(certificateVerifies(oldCert, rotated.body.publicKey)).toBe(false);

    const newCert = (
      await server.request("POST", `/keys/${key.body.id}/certificate`, {
        body: {},
      })
    ).body;
    expect(newCert.validityDays).toBe(7);
    expect(
      certificateVerifies(newCert.certificate, rotated.body.publicKey),
    ).toBe(true);
  });

  it("deletes the CA", async () => {
    server = await startServer();
    await claim();
    await server.request("POST", "/ca", { body: {} });
    expect((await server.request("DELETE", "/ca")).status).toBe(200);
    expect((await server.request("GET", "/ca")).body).toEqual({ ca: null });
    expect((await server.request("DELETE", "/ca")).status).toBe(404);
    expect(
      (await server.request("GET", "/u/alice/ca", { user: null })).status,
    ).toBe(404);
  });
});

describe("access", () => {
  const managementRoutes: Array<[string, string]> = [
    ["GET", "/me"],
    ["GET", "/check/alice"],
    ["POST", "/"],
    ["PUT", "/"],
    ["DELETE", "/"],
    ["POST", "/keys"],
    ["POST", "/keys/generate"],
    ["PATCH", "/keys/1"],
    ["DELETE", "/keys/1"],
    ["POST", "/keys/1/certificate"],
    ["GET", "/ca"],
    ["POST", "/ca"],
    ["POST", "/ca/rotate"],
    ["DELETE", "/ca"],
    ["GET", "/linked-credentials"],
    ["GET", "/credentials"],
  ];

  it("serves the resolver without auth", async () => {
    server = await startServer({ permissions: [] });
    await server.db.sqlite
      .prepare(
        "INSERT INTO p_termix_identity_identities (user_id, handle) VALUES ('user-1', 'alice')",
      )
      .run();
    for (const path of ["/u/alice", "/u/alice/ED25519"]) {
      expect((await server.request("GET", path, { user: null })).status).toBe(
        200,
      );
    }
    expect(
      (await server.request("GET", "/u/alice/ca", { user: null })).status,
    ).toBe(404);
  });

  it.each(managementRoutes)("needs a login for %s %s", async (method, path) => {
    server = await startServer();
    const response = await server.request(method, path, {
      user: null,
      body: method === "GET" ? undefined : {},
    });
    expect(response.status).toBe(401);
  });

  it.each(managementRoutes)(
    "needs termix-identity.use for %s %s",
    async (method, path) => {
      server = await startServer({ permissions: [] });
      const response = await server.request(method, path, {
        body: method === "GET" ? undefined : {},
      });
      expect(response.status).toBe(403);
    },
  );
});

describe("activate", () => {
  it.each(["db:own", "network:serve"])(
    "fails closed without %s",
    async (capability) => {
      const mock = createMockCtx({
        pluginId: manifest.id,
        manifest,
        capabilities: manifest.capabilities.filter((c) => c !== capability),
      });
      const { activate } = await import("../../src/backend/index.js");
      await expect(activate(mock.ctx)).rejects.toThrow(capability);
    },
  );

  it("cannot seal a CA key without secrets:own", async () => {
    server = await startServer({
      capabilities: manifest.capabilities.filter((c) => c !== "secrets:own"),
    });
    await claim();
    expect((await server.request("POST", "/ca", { body: {} })).status).toBe(
      500,
    );
    expect((await server.request("GET", "/ca")).body).toEqual({ ca: null });
  });

  it("cannot read saved keys without credentials:use", async () => {
    server = await startServer({
      capabilities: manifest.capabilities.filter(
        (c) => c !== "credentials:use",
      ),
      sshKeyCredentials: [{ id: 5, name: "k", username: null, publicKey: "x" }],
    });
    expect((await server.request("GET", "/credentials")).status).toBe(500);
  });
});
