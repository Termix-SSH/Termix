/**
 * Comparable form of a host address: bracketed IPv6 literals and hostname
 * casing are presentation, not identity.
 */
export function normalizeHostAddress(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/^\[|\]$/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Whether a host id resolved to a different machine than the client meant.
 *
 * A client addresses a host by the numeric row id of the database it is
 * displaying. When the desktop app delegates a connection to a remote sync
 * server, the id is resolved against *that* server's table instead, and
 * autoincrement ids need not line up between the two — they diverge as soon as
 * the sides accumulate inserts and deletes in a different order.
 *
 * The resolved row then supplies the address, the credentials, the jump hosts
 * and the stored host key, so a mismatch opens an interactive shell on a
 * machine the user did not pick.
 *
 * Returns false when the server has no address to compare: the caller falls
 * back to what the client supplied, which is the behaviour of every setup that
 * never stored the host server-side.
 */
export function hostAddressMismatch(
  clientAddress: unknown,
  resolvedAddress: unknown,
): boolean {
  const resolved = normalizeHostAddress(resolvedAddress);
  if (!resolved) return false;

  return resolved !== normalizeHostAddress(clientAddress);
}
