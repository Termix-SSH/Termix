// Supply chain attacks a real server takes through its upload route. The
// signing key is made for this run and lives only in memory; no server
// trusts it. Revoked keys and expired certificates need the compiled in
// roots, so they are checked in process (hostile-supply.test.ts).
import crypto from "node:crypto";
import zlib from "node:zlib";
import { call } from "../../authz/lib/client.mjs";

const BLOCK = 512;

function header(name, size, type = "0", linkname = "") {
  const buf = Buffer.alloc(BLOCK);
  buf.write(name, 0, 100, "utf8");
  buf.write("0000644\0", 100, 8, "ascii");
  buf.write("0000000\0", 108, 8, "ascii");
  buf.write("0000000\0", 116, 8, "ascii");
  buf.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
  buf.write("00000000000\0", 136, 12, "ascii");
  buf.write("        ", 148, 8, "ascii");
  buf.write(type, 156, 1, "ascii");
  buf.write(linkname, 157, 100, "utf8");
  buf.write("ustar\0", 257, 6, "ascii");
  buf.write("00", 263, 2, "ascii");
  let sum = 0;
  for (const byte of buf) sum += byte;
  buf.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return buf;
}

/** A gzipped tar from [{ name, body, type?, linkname? }], written by hand. */
export function makeTmxplug(entries) {
  const parts = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? "");
    parts.push(header(entry.name, body.length, entry.type, entry.linkname));
    if (body.length) {
      parts.push(body, Buffer.alloc((BLOCK - (body.length % BLOCK)) % BLOCK));
    }
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return zlib.gzipSync(Buffer.concat(parts));
}

function manifest(id) {
  return JSON.stringify({
    id,
    name: "Hostile Upload",
    version: "1.0.0",
    description: "Test upload. Never shipped.",
    author: { name: "Termix" },
    license: "Apache-2.0",
    category: "Access & Security",
    icon: "Upload",
    engine: { termix: ">=26.11.2-0", api: "^2.0.0" },
    capabilities: [],
    sandbox: {},
    platforms: ["linux", "win32", "darwin"],
  });
}

function plainPack(id, extra = []) {
  return makeTmxplug([
    { name: "manifest.json", body: manifest(id) },
    { name: "dist/package.json", body: '{ "type": "module" }\n' },
    { name: "dist/backend.js", body: "export function activate() {}\n" },
    ...extra,
  ]);
}

/** Ed25519 over the sha256 of the file, the shape core checks. */
function sign(buffer, privateKey) {
  const digest = crypto.createHash("sha256").update(buffer).digest();
  return crypto.sign(null, digest, privateKey).toString("base64");
}

async function upload(world, buffer, signature) {
  const headers = {
    authorization: `Bearer ${world.admin.token}`,
    "content-type": "application/octet-stream",
  };
  if (signature) {
    headers["x-termix-plugin-signature"] =
      Buffer.from(signature).toString("base64");
  }
  try {
    const res = await fetch(`${world.base}/plugins/upload`, {
      method: "POST",
      headers,
      body: buffer,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, text: text.slice(0, 500), json };
  } catch (error) {
    return { status: 0, text: String(error) };
  }
}

async function developerMode(world, enabled) {
  return call(world.base, {
    method: "PUT",
    path: "/plugins/developer-mode",
    identity: world.admin,
    body: { enabled },
  });
}

const accepted = (res) => res.status >= 200 && res.status < 300;

export async function runSupply(world, log) {
  const results = {};
  const { privateKey } = crypto.generateKeyPairSync("ed25519");

  await developerMode(world, false);
  const off = await upload(world, plainPack("hostile-upload"));
  results["supply.upload-dev-off"] = {
    worked: accepted(off),
    detail: `gave ${off.status}`,
  };

  const on = await developerMode(world, true);
  if (!accepted(on)) {
    log?.(`could not turn developer mode on: ${on.status} ${on.text}`);
  }

  const pack = plainPack("hostile-upload");
  const bad = await upload(world, pack, "bm90IGEgc2lnbmF0dXJl");
  results["supply.upload-bad-sig"] = {
    worked: accepted(bad),
    detail: `gave ${bad.status} ${bad.text?.slice(0, 160)}`,
  };

  const untrusted = await upload(world, pack, sign(pack, privateKey));
  results["supply.upload-untrusted-key"] = {
    worked: accepted(untrusted),
    detail: `gave ${untrusted.status} ${untrusted.text?.slice(0, 160)}`,
  };

  const bundled = await upload(world, plainPack("hostile-victim"));
  results["supply.upload-replace-bundled"] = {
    worked: accepted(bundled),
    detail: `gave ${bundled.status} ${bundled.text?.slice(0, 160)}`,
  };

  // Staging is not enough: install, then see whether anything landed outside.
  const escapes = {
    "supply.upload-path-escape": plainPack("hostile-escape", [
      { name: "../../hostile-escaped.txt", body: "escaped" },
      { name: "dist/../../../hostile-escaped2.txt", body: "escaped" },
    ]),
    "supply.upload-symlink": plainPack("hostile-link", [
      { name: "dist/link", type: "2", linkname: "../../../" },
    ]),
  };
  for (const [id, buffer] of Object.entries(escapes)) {
    const staged = await upload(world, buffer);
    let installed = null;
    if (accepted(staged) && staged.json?.token) {
      installed = await call(world.base, {
        method: "POST",
        path: `/plugins/upload/${staged.json.token}/install`,
        identity: world.admin,
        body: { capabilities: staged.json.capabilities ?? [] },
      });
    }
    const outside = await world.findEscapes?.();
    results[id] = {
      worked: Boolean(outside?.length),
      detail: `upload ${staged.status}, install ${installed?.status ?? "-"}, outside files: ${outside?.join(", ") || "none"}`,
    };
  }

  const control = await upload(world, plainPack("hostile-upload"));
  results["supply.upload-control"] = {
    worked: accepted(control),
    detail: `gave ${control.status}`,
  };

  await developerMode(world, false);
  log?.("supply chain checks done");
  return results;
}
