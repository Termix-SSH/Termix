import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/backend/database/db/schema.ts",
  out: "./drizzle/sqlite",
});
