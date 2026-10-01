import type { PluginContext } from "@termix/plugin-sdk/backend";

/**
 * The access token for one source, kept out of the sources table and in
 * ctx.secrets instead, the same move the ai plugin made for provider API
 * keys: encrypted with the installation key rather than the owner's data
 * key, so it is readable whenever the plugin runs rather than only while the
 * owner is signed in. A shared source's token is still only ever handed to
 * its owner's part of the resolve, so a read for any other acting user runs
 * as the owner through ctx.asUser.
 */

function tokenKey(sourceId: string): string {
  return `source:${sourceId}`;
}

export function createTokenStore(ctx: PluginContext) {
  return {
    async set(sourceId: string, token: string): Promise<void> {
      await ctx.secrets.set(tokenKey(sourceId), token);
    },

    async clear(sourceId: string): Promise<void> {
      await ctx.secrets.delete(tokenKey(sourceId));
    },

    /** Reads the token as the source's owner, whoever is currently acting. */
    async getForOwner(
      sourceId: string,
      ownerId: string,
    ): Promise<string | null> {
      return ctx.asUser(ownerId, () => ctx.secrets.get(tokenKey(sourceId)));
    },
  };
}

export type TokenStore = ReturnType<typeof createTokenStore>;
