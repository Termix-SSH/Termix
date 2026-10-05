/**
 * How a host update writes ssh_options, kept apart from the route so it can
 * be tested on its own.
 */

import { createCurrentHostResolutionRepository } from "../repositories/factory.js";
import { parseSshOptions } from "../../hosts/ssh-options.js";
import { OWNER_PRIVATE_SSH_OPTION_FIELDS } from "./host-normalizers.js";

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
 * A 2.8 client's terminalConfig only feeds sshOptions, which the route has
 * already taken from it. A shared editor never changes the owner's private
 * SSH options. Returns an error for a terminalConfig that cannot be read.
 */
export async function mergeStoredSshOptions(
  sshDataObj: Record<string, unknown>,
  hostData: Record<string, unknown>,
  hostId: number,
  ownerId: string,
  isOwner: boolean,
): Promise<string | null> {
  if (
    hostData.terminalConfig !== undefined &&
    hostData.terminalConfig !== null &&
    !parseTerminalConfig(hostData.terminalConfig)
  ) {
    return "Invalid terminal config";
  }
  delete sshDataObj.terminalConfig;

  if (isOwner || sshDataObj.sshOptions === undefined) return null;

  const stored = await createCurrentHostResolutionRepository().findHostById(
    hostId,
    ownerId,
  );
  const options = parseSshOptions(sshDataObj.sshOptions);
  const storedOptions = parseSshOptions(stored?.sshOptions);
  for (const field of OWNER_PRIVATE_SSH_OPTION_FIELDS) {
    if (storedOptions[field] !== undefined) {
      options[field] = storedOptions[field];
    } else {
      delete options[field];
    }
  }
  sshDataObj.sshOptions = JSON.stringify(options);
  return null;
}
