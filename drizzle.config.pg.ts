import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/backend/database/db/schema.pg.ts",
  out: "./drizzle/postgres",
});
