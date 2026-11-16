// Holds one marker in every place a plugin can keep data. The hostile
// plugins try to read it; the runner looks for it in what they got back.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { defineTable, id, text } from "@termix-ssh/plugin-sdk/db";

const secrets = defineTable("secrets", {
  id: id(),
  value: text().notNull(),
});

export async function activate(ctx) {
  const table = await ctx.db.define(secrets);
  const db = await ctx.db.client();
  const dir = await ctx.files.dataDir();
  const file = path.join(dir, "secret.txt");

  let marker = await ctx.kv.get("marker");
  if (!marker) {
    marker = `victim-${crypto.randomBytes(12).toString("hex")}`;
    await ctx.kv.set("marker", marker);
    await db.insert(table).values({ value: marker });
  }
  fs.writeFileSync(file, marker);

  const router = ctx.http.router();
  // The runner reads these to know what a leak looks like.
  // Secrets belong to a user, so they are made inside a request.
  router.get("/marker", async (_req, res) => {
    await ctx.secrets.set("marker", marker);
    const sealed = await ctx.secrets.seal(marker);
    res.json({ marker, sealed, dataDir: dir });
  });
  router.get("/ping", (_req, res) => {
    res.json({ ok: true, plugin: "hostile-victim" });
  });
}
