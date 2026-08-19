// Proxmox node names are restricted to [a-zA-Z0-9-] by PVE itself,
// but we validate defensively before using in a shell command.
const SAFE_NODE_RE = /^[a-zA-Z0-9._-]{1,64}$/;

export function isSafeNodeName(name: string): boolean {
  return SAFE_NODE_RE.test(name);
}
