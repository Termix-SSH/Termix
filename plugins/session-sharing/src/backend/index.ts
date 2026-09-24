import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { SharingDeps } from "./deps.js";
import { createLiveSessions, isSharingEnabledForHost } from "./live.js";
import { createRateLimiter } from "./rate-limit.js";
import {
  createDirectory,
  createRoomRepository,
  createShareRepository,
  type CoreRefs,
  type Tables,
} from "./repositories.js";
import { CollabRoomHub } from "./room-hub.js";
import { createRoomActions, registerRoomRoutes } from "./room-routes.js";
import { CollabRuntimeStore } from "./runtime-store.js";
import {
  SESSION_GUESTS_KEY,
  createSessionGuests,
  createSessionSharingService,
} from "./services.js";
import { registerShareRoutes } from "./share-routes.js";
import { roomMembers, rooms, shareParticipants, shares } from "./tables.js";

export async function activate(ctx: PluginContext) {
  const tables: Tables = {
    shares: await ctx.db.define(shares),
    participants: await ctx.db.define(shareParticipants),
    rooms: await ctx.db.define(rooms),
    members: await ctx.db.define(roomMembers),
  };
  const refs = () => ctx.db.refs<CoreRefs>();

  const directory = createDirectory(ctx.db, refs);
  const store = new CollabRuntimeStore(ctx.log);
  const hub = new CollabRoomHub(store);
  const resolveLimiter = createRateLimiter({
    windowMs: 60_000,
    maxAttempts: 30,
  });
  const guestLimiter = createRateLimiter({ windowMs: 60_000, maxAttempts: 60 });
  ctx.disposables.add(() => {
    hub.dispose();
    resolveLimiter.dispose();
    guestLimiter.dispose();
    return store.close();
  });

  const deps: SharingDeps = {
    ctx,
    shares: createShareRepository(ctx.db, tables),
    rooms: createRoomRepository(ctx.db, tables, refs),
    directory,
    live: createLiveSessions(ctx),
    hub,
    store,
    resolveLimiter,
    guestLimiter,
    isSharingEnabledForHost: (hostId) =>
      isSharingEnabledForHost(ctx, directory.hostExists, hostId),
  };

  const actions = createRoomActions(deps);
  store.onEvent(actions.onRuntimeEvent);

  // Guest links carry their own token, checked in the handlers.
  const router = ctx.http.router<Router>({
    public: ["/resolve/:linkToken", "/guest/:token"],
  });
  registerShareRoutes(router, deps);
  registerRoomRoutes(router, deps, actions);

  ctx.services.provide("sessions.sharing", createSessionSharingService(deps));
  ctx.registry.provide(SESSION_GUESTS_KEY, createSessionGuests(deps));

  ctx.log.info("Session sharing mounted at /plugin-api/session-sharing");
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
