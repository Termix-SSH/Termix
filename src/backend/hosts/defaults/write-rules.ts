/**
 * How a host write decides which core keys the host sets itself.
 *
 * - A write that carries `defaultOverrides` says so outright (the host
 *   editor). Values it sends for inherited keys are replaced by what
 *   resolves.
 * - An update without one (an API client, Termix-Mobile) keeps what was
 *   overridden, and a key whose value changed becomes overridden.
 * - A create without one (import, quick connect, enroll) inherits every key
 *   whose value matches what resolves, or that it left out.
 *
 * Plugin namespaces are not in the host body. They keep their state here and
 * are classified or rewritten by the materialize pass that follows the write.
 */

import type { HostRow } from "../../database/repositories/host-defaults-repository.js";
import {
  CORE_NAMESPACE,
  defaultValuesEqual,
  parseDefaultOverrides,
  type DefaultOverrides,
} from "../../../types/host-defaults.js";
import { coreCatalogEntries } from "./catalog.js";
import { readCoreDefault, writeCoreDefault } from "./core-columns.js";
import { loadDefaultsIndex, levelsForHost } from "./levels.js";
import { loadPlacement, resolveForHost } from "./materialize.js";
import { effectiveFolderPath, isOwnValue } from "./resolve.js";

export interface HostDefaultsWrite {
  /** The host's owner, whose defaults apply. */
  ownerId: string;
  /** Null on create. */
  hostId: number | null;
  /** The column object the route is about to write. Changed in place. */
  columns: Record<string, unknown>;
  /** The request body as sent. */
  body: Record<string, unknown>;
  /** The row before an update. */
  stored?: HostRow | null;
  /** Core keys this caller may not change, which keep their state. */
  lockedKeys?: string[];
}

/** Body fields each core key is read from, to tell a left-out key on create. */
const BODY_FIELDS: Record<string, string[]> = {
  username: ["username"],
  sshPort: ["sshPort", "port"],
  auth: ["authType", "authMethod", "credentialId"],
  forceKeyboardInteractive: ["forceKeyboardInteractive"],
  keepaliveInterval: ["sshOptions", "terminalConfig"],
  keepaliveCountMax: ["sshOptions", "terminalConfig"],
  allowLegacyAlgorithms: ["sshOptions", "terminalConfig"],
  agentForwarding: ["sshOptions", "terminalConfig"],
  environmentVariables: ["sshOptions", "terminalConfig"],
  socks5: ["useSocks5"],
  jumpHosts: ["jumpHosts"],
  portKnockSequence: ["portKnockSequence"],
  statusCheckEnabled: ["statusCheckEnabled"],
  statusCheckInterval: ["statusCheckInterval"],
};

function leftOut(body: Record<string, unknown>, key: string): boolean {
  const fields = BODY_FIELDS[key] ?? [key];
  return fields.every((field) => body[field] === undefined);
}

/**
 * Fills inherited core keys into `columns` and returns the host's overrides.
 * The caller stores them as `defaultOverrides`.
 */
export async function applyHostDefaultsToWrite(
  write: HostDefaultsWrite,
): Promise<DefaultOverrides> {
  const { ownerId, hostId, columns, body, stored } = write;
  const sent = parseDefaultOverrides(body.defaultOverrides);
  const before = parseDefaultOverrides(stored?.defaultOverrides);
  const locked = new Set(write.lockedKeys ?? []);

  const placement = await loadPlacement([ownerId]);
  const self = hostId ?? -1;
  placement.set(self, {
    folder: (columns.folder !== undefined
      ? columns.folder
      : (stored?.folder ?? null)) as string | null,
    parentHostId: (columns.parentHostId !== undefined
      ? columns.parentHostId
      : (stored?.parentHostId ?? null)) as number | null,
  });
  const index = await loadDefaultsIndex([ownerId]);
  const levels = levelsForHost(
    index,
    ownerId,
    effectiveFolderPath(self, placement),
  );

  const storedColumns = (stored ?? {}) as Record<string, unknown>;
  // A partial write (a plugin's ctx.hosts.update) leaves the rest as stored.
  const incoming = (key: string) =>
    readCoreDefault(key, { ...storedColumns, ...columns });
  const previous = (key: string) => readCoreDefault(key, storedColumns);

  const overridden: string[] = [];
  for (const info of coreCatalogEntries()) {
    const resolved = resolveForHost(info, levels, hostId);
    let own: boolean;
    if (locked.has(info.key)) {
      own = before?.[CORE_NAMESPACE]?.includes(info.key) ?? true;
      if (own) overridden.push(info.key);
      continue;
    }
    if (sent?.[CORE_NAMESPACE]) {
      own = sent[CORE_NAMESPACE].includes(info.key);
    } else if (stored && before?.[CORE_NAMESPACE]) {
      own =
        before[CORE_NAMESPACE].includes(info.key) ||
        !defaultValuesEqual(
          info.normalize(incoming(info.key)),
          info.normalize(previous(info.key)),
        );
    } else if (!stored && leftOut(body, info.key)) {
      own = false;
    } else {
      own = isOwnValue(info, incoming(info.key), resolved);
    }

    if (own || !resolved) {
      if (own) overridden.push(info.key);
      continue;
    }
    Object.assign(
      columns,
      writeCoreDefault(
        info.key,
        resolved.value,
        { ...storedColumns, ...columns },
        storedColumns.sshOptions,
      ),
    );
  }

  const overrides: DefaultOverrides = { ...(before ?? {}) };
  if (sent) {
    for (const [namespace, keys] of Object.entries(sent)) {
      if (namespace !== CORE_NAMESPACE) overrides[namespace] = keys;
    }
  }
  overrides[CORE_NAMESPACE] = overridden.sort();
  return overrides;
}
