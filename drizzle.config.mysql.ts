import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "mysql",
  schema: "./src/backend/database/db/schema.mysql.ts",
  out: "./drizzle/mysql",
});
