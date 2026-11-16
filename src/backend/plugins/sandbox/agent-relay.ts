/**
 * The host's ssh agent for a plugin that runs its own ssh2 client. The agent
 * stays in core; the plugin's client gets a stand-in that asks core for the
 * public keys and for each signature.
 */
import ssh2 from "ssh2";

/** The agent's two calls as functions that can cross to a plugin process. */
export interface AgentRelay {
  identities: () => Promise<Buffer[]>;
  sign: (
    publicKey: unknown,
    data: unknown,
    options?: unknown,
  ) => Promise<Buffer>;
}

const SIGN_HASHES = new Set(["sha1", "sha256", "sha512"]);
const MAX_KEY_BYTES = 16 * 1024;
const MAX_SIGN_BYTES = 256 * 1024;

function publicBlob(key: unknown): Buffer | null {
  if (Buffer.isBuffer(key)) return key;
  const getter = (key as { getPublicSSH?: () => unknown } | null)?.getPublicSSH;
  if (typeof getter !== "function") return null;
  const blob = getter.call(key);
  return Buffer.isBuffer(blob) ? blob : null;
}

/**
 * The host's ssh agent stays in core. The plugin's client gets its public
 * keys and asks core to sign, and only with a key the agent listed.
 */
export function agentRelay(agent: unknown): AgentRelay | null {
  const inner = agent as ssh2.BaseAgent | null;
  if (
    !inner ||
    typeof inner.getIdentities !== "function" ||
    typeof inner.sign !== "function"
  ) {
    return null;
  }
  const listed = new Set<string>();
  return {
    identities: () =>
      new Promise((resolve, reject) => {
        inner.getIdentities((err, keys) => {
          if (err) return reject(new Error("The SSH agent gave no keys"));
          const blobs = (keys ?? [])
            .map(publicBlob)
            .filter((blob): blob is Buffer => blob !== null);
          for (const blob of blobs) listed.add(blob.toString("hex"));
          resolve(blobs);
        });
      }),
    sign: (publicKey, data, options) =>
      new Promise((resolve, reject) => {
        const blob = Buffer.isBuffer(publicKey) ? publicKey : null;
        if (
          !blob ||
          blob.length > MAX_KEY_BYTES ||
          !listed.has(blob.toString("hex")) ||
          !Buffer.isBuffer(data) ||
          data.length > MAX_SIGN_BYTES
        ) {
          return reject(new Error("The SSH agent can't sign that"));
        }
        const parsed = ssh2.utils.parseKey(blob);
        if (!parsed || parsed instanceof Error) {
          return reject(new Error("The SSH agent can't sign that"));
        }
        const hash = (options as { hash?: unknown } | null)?.hash;
        const opts =
          typeof hash === "string" && SIGN_HASHES.has(hash)
            ? { hash: hash as "sha1" | "sha256" | "sha512" }
            : {};
        inner.sign(parsed, data, opts, (err, signature) => {
          if (err || !Buffer.isBuffer(signature)) {
            return reject(new Error("The SSH agent refused to sign"));
          }
          resolve(signature);
        });
      }),
  };
}

/** The plugin side: an ssh2 agent that hands every call to core. */
export function relayedAgent(relay: AgentRelay): ssh2.BaseAgent {
  class RelayedAgent extends ssh2.BaseAgent {
    getIdentities(
      cb: (err: Error | undefined, keys?: ssh2.ParsedKey[]) => void,
    ): void {
      relay.identities().then(
        (blobs) => {
          const keys: ssh2.ParsedKey[] = [];
          for (const blob of blobs ?? []) {
            const parsed = ssh2.utils.parseKey(Buffer.from(blob));
            if (parsed && !(parsed instanceof Error)) keys.push(parsed);
          }
          cb(undefined, keys);
        },
        (err) => cb(err instanceof Error ? err : new Error(String(err))),
      );
    }

    sign(
      pubKey: ssh2.ParsedKey | Buffer | string,
      data: Buffer,
      optionsOrCb: ssh2.SigningRequestOptions | ssh2.SignCallback,
      cb?: ssh2.SignCallback,
    ): void {
      const done = (typeof optionsOrCb === "function" ? optionsOrCb : cb) as
        ssh2.SignCallback | undefined;
      const options = typeof optionsOrCb === "function" ? {} : optionsOrCb;
      let blob = publicBlob(pubKey);
      if (!blob && typeof pubKey === "string") {
        const parsed = ssh2.utils.parseKey(pubKey);
        blob = parsed instanceof Error ? null : publicBlob(parsed);
      }
      if (!blob) {
        done?.(new Error("The SSH agent can't sign that"));
        return;
      }
      relay.sign(blob, data, { hash: options?.hash }).then(
        (signature) => done?.(undefined, Buffer.from(signature)),
        (err) => done?.(err instanceof Error ? err : new Error(String(err))),
      );
    }
  }
  return new RelayedAgent();
}
