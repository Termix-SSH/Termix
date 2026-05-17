export type DockerSessionAccessState = "allowed" | "missing" | "forbidden";

type SessionWithOptionalOwner = {
  userId?: string;
};

export function hasDockerSessionOwnership(
  session: SessionWithOptionalOwner | undefined,
  userId: string,
): boolean {
  return !!session && (!session.userId || session.userId === userId);
}

export function getDockerSessionAccessState(
  session: SessionWithOptionalOwner | undefined,
  userId: string,
): DockerSessionAccessState {
  if (!session) {
    return "missing";
  }

  return hasDockerSessionOwnership(session, userId) ? "allowed" : "forbidden";
}
