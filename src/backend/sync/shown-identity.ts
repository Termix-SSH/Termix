/**
 * On a desktop linked to a server, the account it is signed in to there.
 * That account is who the user is; the local profile only mirrors it.
 */
export async function describeDesktopLink(userId: string) {
  if (process.env.ELECTRON_EMBEDDED !== "true") return null;
  try {
    const { getLink } = await import("./client/link-store.js");
    const link = await getLink(userId);
    if (!link) return null;
    return {
      serverUrl: link.serverUrl,
      serverName: link.serverName,
      username: link.account?.username ?? link.remoteUsername,
      isAdmin: !!link.account?.isAdmin,
      roles: link.account?.roles ?? [],
      permissions: link.account?.permissions ?? [],
      status: link.status,
    };
  } catch {
    return null;
  }
}

/**
 * Who the app shows. On a desktop linked to a server that is the account it
 * is signed in to there, not the local user that holds the copy of its data.
 */
export async function shownIdentity(user: {
  id: string;
  username: string;
  isAdmin: boolean | null;
}) {
  const linked = await describeDesktopLink(user.id);
  return {
    linked,
    username: linked?.username || user.username,
    isAdmin: linked ? linked.isAdmin : !!user.isAdmin,
  };
}
