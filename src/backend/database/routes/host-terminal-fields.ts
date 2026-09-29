/**
 * How a host update writes terminal_config and ssh_options, kept apart from
 * the route so it can be tested on its own.
 */

import { createCurrentHostResolutionRepository } from "../repositories/factory.js";
import { parseSshOptions } from "../../hosts/ssh-options.js";
import {
  OWNER_PRIVATE_SSH_OPTION_FIELDS,
  OWNER_PRIVATE_TERMINAL_CONFIG_FIELDS,
} from "./host-normalizers.js";

export function parseTerminalConfig(
  value: unknown,
): Record<string, unknown> | null {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? { ...(parsed as Record<string, unknown>) }
    : null;
}

/**
 * terminal_config is merged into what is stored rather than replaced. The
 * 2.8 keys the editor no longer sends (the terminal's look, which the
 * ssh-terminal plugin copies into its host settings, and a sudo password 2.8
 * editors kept there) stay until 3.0.0 drops the column. A shared editor
 * never changes the owner's private keys in either JSON. Returns an error
 * for a terminalConfig that cannot be read.
 */
export async function mergeStoredTerminalFields(
  sshDataObj: Record<string, unknown>,
  hostData: Record<string, unknown>,
  hostId: number,
  ownerId: string,
  isOwner: boolean,
): Promise<string | null> {
  const sentTerminalConfig =
    hostData.terminalConfig !== undefined && hostData.terminalConfig !== null;
  const incoming = sentTerminalConfig
    ? parseTerminalConfig(hostData.terminalConfig)
    : null;
  if (sentTerminalConfig && !incoming) return "Invalid terminal config";
  delete sshDataObj.terminalConfig;

  const sentSudoPassword = isOwner && hostData.sudoPassword !== undefined;
  if (!incoming && !sentSudoPassword && sshDataObj.sshOptions === undefined) {
    return null;
  }

  const stored = await createCurrentHostResolutionRepository().findHostById(
    hostId,
    ownerId,
  );
  const storedConfig = parseTerminalConfig(stored?.terminalConfig) ?? {};

  if (incoming || (sentSudoPassword && "sudoPassword" in storedConfig)) {
    const merged = { ...storedConfig, ...(incoming ?? {}) };
    if (!isOwner) {
      for (const field of OWNER_PRIVATE_TERMINAL_CONFIG_FIELDS) {
        if (field in storedConfig) merged[field] = storedConfig[field];
        else delete merged[field];
      }
    }
    // A sudo password saved on its own lives in the encrypted column.
    if (sentSudoPassword) delete merged.sudoPassword;
    sshDataObj.terminalConfig = JSON.stringify(merged);
  }

  if (!isOwner && sshDataObj.sshOptions !== undefined) {
    const options = parseSshOptions(sshDataObj.sshOptions);
    const storedOptions = parseSshOptions(stored?.sshOptions ?? storedConfig);
    for (const field of OWNER_PRIVATE_SSH_OPTION_FIELDS) {
      if (storedOptions[field] !== undefined) {
        options[field] = storedOptions[field];
      } else {
        delete options[field];
      }
    }
    sshDataObj.sshOptions = JSON.stringify(options);
  }
  return null;
}
