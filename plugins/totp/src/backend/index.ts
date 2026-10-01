import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { enrollments } from "./tables.js";
import { createEnrollmentRepository } from "./repository.js";
import { createTotpService, FACTOR_ID, normalizeCode } from "./totp.js";
import { registerTotpRoutes } from "./routes.js";

export async function activate(ctx: PluginContext) {
  const table = await ctx.db.define(enrollments);
  const totp = createTotpService(
    ctx,
    createEnrollmentRepository(ctx.db, table),
  );

  ctx.auth.registerSecondFactor({
    id: FACTOR_ID,
    labelKey: "factor",
    isEnrolled: (userId) => totp.isEnrolled(userId),
    verify: async (userId, body) => {
      const result = await totp.checkCode(
        userId,
        normalizeCode(body.totp_code ?? body.code),
      );
      if (result === null) {
        return {
          ok: false,
          error:
            "Your authenticator could not be read. Contact an admin to reset your second factor.",
        };
      }
      return result;
    },
    reset: (userId) => totp.remove(userId),
  });

  registerTotpRoutes(ctx.http.router<Router>(), ctx, totp);
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
