import { defineConfig } from "drizzle-kit";

// Test DB riêng (khác dev và production). Đọc `TEST_DATABASE_URL` — cùng biến mà
// `src/lib/p3/__tests__/integration/test-setup.ts` kiểm tra an toàn — và fallback về
// DB test local mặc định để `npm run test:db:*` vẫn chạy được khi chưa export biến.
// `||` (không phải `??`): chuỗi rỗng cũng coi như chưa set, giống guard bên test-setup.
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL?.replace("postgresql+asyncpg://", "postgresql://") ||
  "postgresql://postgres:postgres@localhost:5432/narrative_health_test";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url: testDatabaseUrl,
  },
});
