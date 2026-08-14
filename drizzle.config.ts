import { defineConfig } from "drizzle-kit";

const databaseUrl =
  process.env.DATABASE_URL?.replace("postgresql+asyncpg://", "postgresql://") ??
  "postgresql://postgres:postgres@localhost:5432/narrative_health";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url: databaseUrl,
  },
});
