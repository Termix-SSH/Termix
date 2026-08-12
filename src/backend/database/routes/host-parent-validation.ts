import { createCurrentHostResolutionRepository } from "../repositories/factory.js";

/**
 * Validates a proposed parentHostId for a host owned by `userId`.
 *
 * Rejects a parent that doesn't exist/isn't owned by the same user, a
 * self-reference, and any assignment that would create a cycle (the
 * candidate parent's own ancestor chain already contains the host being
 * assigned). Walks parentHostId in-app rather than via a recursive SQL CTE,
 * matching the existing ancestor-walk convention in
 * findFolderCredentialId (host-resolution-repository.ts).
 *
 * `hostId` is null when validating a create (the host doesn't have an id
 * yet, so only self-reference/cycle-with-itself is impossible to hit).
 */
export async function validateParentHostId(
  userId: string,
  hostId: number | null,
  parentHostId: number,
): Promise<string | null> {
  if (hostId !== null && parentHostId === hostId) {
    return "A host cannot be its own parent";
  }

  const links =
    await createCurrentHostResolutionRepository().listOwnHostParentLinks(
      userId,
    );
  const linksById = new Map(links.map((link) => [link.id, link.parentHostId]));

  if (!linksById.has(parentHostId)) {
    return "Parent host not found";
  }

  let current: number | null = parentHostId;
  const visited = new Set<number>();
  while (current !== null) {
    if (hostId !== null && current === hostId) {
      return "That host is a descendant of this host, and cannot be its parent";
    }
    if (visited.has(current)) break;
    visited.add(current);
    current = linksById.get(current) ?? null;
  }

  return null;
}
