// One-off diagnostic (not committed): sign a session JWT using AUTH_SECRET and
// exercise the middleware gate — verifies that a valid admin cookie passes the
// /admin gate (i.e. the only failure mode left is cookie delivery).
import { signSession, SESSION_COOKIE } from "../src/lib/auth/session";

async function main() {
  let token: string;
  try {
    token = await signSession({ sub: "admin", username: "diag" });
  } catch (e) {
    console.log("SIGN FAILED:", e instanceof Error ? e.message : e);
    process.exit(0);
  }

  // 1. protected page WITH a valid cookie → must NOT redirect to /admin/login
  const withCookie = await fetch("http://127.0.0.1:3000/admin", {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
    redirect: "manual",
  });
  console.log("GET /admin with valid admin cookie →", withCookie.status);

  // 2. protected page WITHOUT cookie → must redirect (307/302) to /admin/login
  const noCookie = await fetch("http://127.0.0.1:3000/admin", { redirect: "manual" });
  console.log("GET /admin without cookie →", noCookie.status, noCookie.headers.get("location") ?? "");

  await process.exit(0);
}
main();
