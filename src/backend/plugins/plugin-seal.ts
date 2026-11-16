/**
 * What ctx.secrets.seal writes: sealed for one plugin only.
 *
 * Each plugin gets its own key, derived from the system key and its id, and
 * the id is bound into the cipher as associated data. Another plugin that
 * gets hold of the text can't open it, and nothing a plugin seals can pass
 * as one of core's own sealed values (system-secret-crypto.ts). The id also
 * sits in clear in the text, so a key rotation can reseal values without
 * knowing which table they came from.
 *
 *   psenc:v1:<plugin id>:<iv>:<tag>:<data>
 */
import crypto from "node:crypto";
import { SystemCrypto } from "../utils/system-crypto.js";

export const PLUGIN_SEAL_PREFIX = "psenc:v1:";
/** Finds sealed values inside any text, like a JSON column. */
export const PLUGIN_SEALED =
  /psenc:v1:[a-z0-9][a-z0-9-]{0,63}:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]*/g;

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function pluginKey(systemKey: Buffer, pluginId: string): Buffer {
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      systemKey,
      Buffer.from("termix-plugin-seal-v1"),
      Buffer.from(pluginId),
      32,
    ),
  );
}

interface Parts {
  pluginId: string;
  iv: Buffer;
  tag: Buffer;
  data: Buffer;
}

function parse(sealed: string): Parts | null {
  if (!sealed.startsWith(PLUGIN_SEAL_PREFIX)) return null;
  const parts = sealed.slice(PLUGIN_SEAL_PREFIX.length).split(":");
  if (parts.length !== 4) return null;
  const [pluginId, iv, tag, data] = parts;
  if (!PLUGIN_ID.test(pluginId) || !iv || !tag) return null;
  return {
    pluginId,
    iv: Buffer.from(iv, "base64"),
    tag: Buffer.from(tag, "base64"),
    data: Buffer.from(data, "base64"),
  };
}

function open(key: Buffer, parts: Parts): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    pluginKey(key, parts.pluginId),
    parts.iv,
    { authTagLength: 16 },
  );
  decipher.setAAD(Buffer.from(parts.pluginId));
  decipher.setAuthTag(parts.tag);
  return Buffer.concat([
    decipher.update(parts.data),
    decipher.final(),
  ]).toString("utf8");
}

function sealWith(key: Buffer, pluginId: string, value: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, pluginKey(key, pluginId), iv);
  cipher.setAAD(Buffer.from(pluginId));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${PLUGIN_SEAL_PREFIX}${pluginId}:${iv.toString("base64")}:${cipher
    .getAuthTag()
    .toString("base64")}:${data.toString("base64")}`;
}

export async function sealForPlugin(
  pluginId: string,
  value: string,
): Promise<string> {
  if (!PLUGIN_ID.test(pluginId)) throw new Error("Bad plugin id");
  const key = await SystemCrypto.getInstance().getEncryptionKey();
  return sealWith(key, pluginId, String(value));
}

/** Opens with the current key, then any previous one. Null when it can't. */
async function openAny(parts: Parts): Promise<{
  value: string;
  current: boolean;
} | null> {
  const system = SystemCrypto.getInstance();
  try {
    return {
      value: open(await system.getEncryptionKey(), parts),
      current: true,
    };
  } catch {
    // sealed before a key rotation, or not a value of ours
  }
  for (const previous of await system.getPreviousKeys("ENCRYPTION_KEY")) {
    try {
      return { value: open(previous, parts), current: false };
    } catch {
      // try the next one
    }
  }
  return null;
}

/** The plugin's own sealed value, or null for anything else. */
export async function unsealForPlugin(
  pluginId: string,
  sealed: unknown,
): Promise<string | null> {
  if (typeof sealed !== "string") return null;
  const parts = parse(sealed);
  if (!parts || parts.pluginId !== pluginId) return null;
  return (await openAny(parts))?.value ?? null;
}

/**
 * Seals again with the current key. Null when it already uses it or is not
 * a value of this kind. Throws when no known key opens it.
 */
export async function resealPluginValue(
  sealed: string,
): Promise<string | null> {
  const parts = parse(sealed);
  if (!parts) return null;
  const opened = await openAny(parts);
  if (!opened) throw new Error("No known key opens this value");
  if (opened.current) return null;
  return sealForPlugin(parts.pluginId, opened.value);
}
