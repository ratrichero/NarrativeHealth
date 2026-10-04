// One-off e2e check (not committed): verify the admin login → cookie → /admin
// flow over plain HTTP. Adds a temporary test admin if none exists with the
// known credentials (additive only — never touches existing rows).
import { Client } from "pg";
import bcrypt from "bcryptjs";
import { SESSION_COOKIE } from "../src/lib/auth/session";

const BASE = "http://127.0.0.1:3000";
const USER = "e2e-admin";
const PASS = "e2e-password-123";

async function ensureTestAdmin() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
  await c.connect();
  const existing = await c.query("SELECT id FROM admin_users WHERE username = $1", [USER]);
  if (existing.rows.length === 0) {
    const hash = await bcrypt.hash(PASS, 10);
    await c.query(
      "INSERT INTO admin_users (username, password_hash, display_name) VALUES ($1, $2, $3)",
      [USER, hash, "E2E Test Admin"]
    );
    console.log("(created test admin row)");
  }
  await c.end();
}

async function main() {
  await ensureTestAdmin();

  const login = await fetch(`${BASE}/api/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  const setCookie = login.headers.get("set-cookie") ?? "";
  const body = (await login.json()) as { success?: boolean; error?: string };
  console.log("login status:", login.status, "success:", body.success, body.error ?? "");
  console.log("set-cookie has Secure flag:", /\bsecure\b/i.test(setCookie));
  console.log("set-cookie has HttpOnly:", /httponly/i.test(setCookie));

  const token = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (!token) {
    console.log("NO TOKEN IN SET-COOKIE — cannot proceed");
    process.exit(1);
  }

  const admin = await fetch(`${BASE}/admin`, {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
    redirect: "manual",
  });
  console.log("GET /admin with cookie →", admin.status, admin.headers.get("location") ?? "");

  const noCookie = await fetch(`${BASE}/admin`, { redirect: "manual" });
  console.log("GET /admin without cookie →", noCookie.status, noCookie.headers.get("location") ?? "");
}
main().catch((e) => {
  console.error("ERR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
