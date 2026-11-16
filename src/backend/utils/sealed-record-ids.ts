/** Record ids that shared secret snapshots are sealed for. */

export function sharedHostSecretRecordId(
  hostAccessId: number,
  targetUserId: string,
  protocol: string,
): string {
  return `shared-${hostAccessId}-${targetUserId}-${protocol}`;
}

export function sharedCredentialSecretRecordId(
  accessId: number,
  targetUserId: string,
): string {
  return `shared-credential-${accessId}-${targetUserId}`;
}
