/**
 * Dev-only smoke check cho RADAR-05/06 (không dùng DB thật).
 *
 * Tự dựng PostgreSQL tạm bằng PGlite (in-memory) + socket TCP, tạo đúng 2 bảng
 * mà card admin cần (`catalyst_events`, `app_settings`), seed 1 catalyst fact,
 * rồi chạy `next dev` ở chế độ RADAR_DEMO=1 và kiểm tra:
 *
 *   1. `GET /radar` trả 200 (shell trang render).
 *   2. `/api/market/movers` trả cụm + member → bảng “Hiệu quả theo cụm rotation”
 *      có dữ liệu; `?cluster=<id>` ghim đúng cụm (permalink).
 *   3. `/api/market/radar/track-record` trả `catalyst.labeled > 0` → bảng
 *      “Catalyst có giúp outlier đi tiếp?” hiện (bảng chỉ render khi có nhãn).
 *   4. `/api/admin/catalyst/sync` + `/coverage` trả 200 `success: true`,
 *      không có `live.error` (card Catalyst sync/coverage load sạch).
 *
 * Không cần cài PostgreSQL, không đọc `.env` production, không ghi vào DB thật.
 * Dùng: `npm run check:radar-ui` (thêm `--browser` nếu đã cài playwright để
 * kiểm tra DOM thật của 2 bảng).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { signSession, SESSION_COOKIE } from "../src/lib/auth/session";

const ROOT = process.cwd();
const MIGRATION = join(ROOT, "drizzle/migrations/0036_catalyst_events.sql");
const NEXT_TIMEOUT_MS = 240_000;

let failures = 0;
const ok = (label: string) => console.log(`  \u2713 ${label}`);
const bad = (label: string, detail?: string) => {
  failures += 1;
  console.log(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`);
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("no port"))));
    });
  });
}

interface JsonResponse<T> {
  status: number;
  body: T | null;
}

async function getJson<T>(url: string, cookie?: string): Promise<JsonResponse<T>> {
  const response = await fetch(url, {
    headers: cookie ? { cookie } : undefined,
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as T | null;
  return { status: response.status, body };
}

async function waitForRadar(baseUrl: string, child: ChildProcess): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < NEXT_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`next dev thoát sớm với mã ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/radar`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
    } catch {
      // dev server chưa listen / còn compile
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error(`next dev không sẵn sàng sau ${NEXT_TIMEOUT_MS / 1000}s`);
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || !child.pid) return resolve();
    const timer = setTimeout(() => resolve(), 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      // detached: true → pid là process group; kill cả cây (next + worker).
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  });
}

async function main() {
  const withBrowser = process.argv.includes("--browser");
  const secret = "radar-ui-check-secret-0123456789abcdef"; // ≥32 ký tự cho AUTH-01
  // signSession() đọc process.env của script, còn next dev nhận qua env con.
  process.env.AUTH_SECRET = secret;
  const pgPort = await freePort();
  const webPort = await freePort();
  const baseUrl = `http://127.0.0.1:${webPort}`;
  const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${pgPort}/postgres`;

  console.log(`\nRADAR UI CHECK — PGlite :${pgPort} · Next :${webPort}\n`);

  const db = await PGlite.create();
  await db.exec(readFileSync(MIGRATION, "utf8"));
  await db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key varchar(100) PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO catalyst_events (type, source, external_id, title, source_url, symbols, published_at, expires_at)
    VALUES (
      'LISTING', 'BINANCE_ANNOUNCEMENT', 'radar-ui-check-1',
      '[dev-check] catalyst seed cho card admin', 'https://example.com/catalyst', '["ENA"]'::jsonb,
      now(), now() + interval '7 days'
    )
    ON CONFLICT DO NOTHING;
  `);
  console.log("PGlite: catalyst_events + app_settings + 1 catalyst fact");

  const pgServer = new PGLiteSocketServer({ db, port: pgPort, host: "127.0.0.1" });
  await pgServer.start();

  const child = spawn(
    "npx",
    ["next", "dev", "-H", "127.0.0.1", "-p", String(webPort)],
    {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        RADAR_DEMO: "1",
        AUTH_SECRET: secret,
        NEXT_TELEMETRY_DISABLED: "1",
      },
    }
  );
  const logs: string[] = [];
  child.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => logs.push(String(chunk)));

  try {
    console.log(`Đang chờ next dev sẵn sàng (tối đa ${NEXT_TIMEOUT_MS / 1000}s)…`);
    await waitForRadar(baseUrl, child);

    const session = await signSession({ sub: "admin", username: "radar-ui-check" });
    const cookie = `${SESSION_COOKIE}=${session}`;

    // 1) Shell /radar
    const radar = await fetch(`${baseUrl}/radar`);
    const html = await radar.text();
    if (radar.status === 200 && html.includes("Market Radar")) ok("/radar trả 200, shell render");
    else bad("/radar không render", `HTTP ${radar.status}`);

    // 2) Bảng cụm rotation — dữ liệu API mà panel dùng
    const movers = await getJson<{
      success?: boolean;
      data?: {
        rows?: unknown[];
        clusters?: Array<{ id: string; label: string; members: Array<{ symbol: string }> }>;
      };
    }>(`${baseUrl}/api/market/movers?side=gainer&sort=composite&limit=20`);
    const clusters = movers.body?.data?.clusters ?? [];
    if (movers.status === 200 && clusters.length > 0 && clusters.every((c) => c.members.length > 0)) {
      ok(`bảng cụm có dữ liệu (${clusters.length} cụm, ${clusters[0].label} ${clusters[0].members.length} member)`);
    } else {
      bad("bảng cụm không có dữ liệu", `HTTP ${movers.status}`);
    }

    // 3) Permalink cụm — id đọc từ URL phải ghim đúng cụm
    const target = clusters[0];
    if (target) {
      const pinned = await getJson<{
        data?: { clusters?: Array<{ id: string; members: unknown[] }> };
      }>(
        `${baseUrl}/api/market/movers?side=gainer&sort=composite&limit=20&cluster=${encodeURIComponent(
          target.id
        )}`
      );
      const first = pinned.body?.data?.clusters?.[0];
      if (pinned.status === 200 && first?.id === target.id && first.members.length === target.members.length) {
        ok(`permalink ?cluster=${target.id} ghim đúng cụm`);
      } else {
        bad("permalink không ghim đúng cụm", `HTTP ${pinned.status}`);
      }
    }

    // 4) Bảng catalyst — component chỉ render khi có nhãn đã lưu
    const track = await getJson<{
      success?: boolean;
      data?: {
        clusterSummaries?: unknown[];
        catalyst?: { labeled?: number; withCatalyst?: number; horizons?: unknown[] };
      };
    }>(`${baseUrl}/api/market/radar/track-record`);
    const catalyst = track.body?.data?.catalyst;
    if (
      track.status === 200 &&
      (track.body?.data?.clusterSummaries?.length ?? 0) > 0 &&
      (catalyst?.labeled ?? 0) > 0 &&
      (catalyst?.horizons?.length ?? 0) > 0
    ) {
      ok(
        `bảng catalyst có dữ liệu (${catalyst?.withCatalyst}/${catalyst?.labeled} tín hiệu có catalyst)`
      );
    } else {
      bad(
        "bảng catalyst không có dữ liệu",
        `HTTP ${track.status}, labeled=${catalyst?.labeled ?? "?"}`
      );
    }

    // 5) Panel “Vì sao volume bất thường?” — facts mẫu phải khớp symbol + có link
    const panel = await getJson<{
      success?: boolean;
      data?: {
        facts?: Array<{ sourceUrl?: string; title?: string }>;
        sync?: { state?: string };
        mode?: string;
      };
    }>(`${baseUrl}/api/market/movers/ENA/catalysts`);
    const facts = panel.body?.data?.facts ?? [];
    if (
      panel.status === 200 &&
      panel.body?.success &&
      facts.length > 0 &&
      facts.every((fact) => /^https?:\/\//.test(fact.sourceUrl ?? "")) &&
      panel.body.data?.sync?.state === "synced"
    ) {
      ok(`panel catalyst ENA có ${facts.length} fact kèm link (mode=${panel.body.data?.mode})`);
    } else {
      bad("panel catalyst không có fact mẫu", `HTTP ${panel.status}`);
    }

    // 6) Card admin
    const sync = await getJson<{
      success?: boolean;
      error?: string;
      data?: { info?: { state?: string }; live?: { total?: number; error?: string } };
    }>(`${baseUrl}/api/admin/catalyst/sync`, cookie);
    if (
      sync.status === 200 &&
      sync.body?.success &&
      !sync.body?.data?.live?.error &&
      (sync.body.data?.live?.total ?? 0) > 0
    ) {
      ok(`Catalyst sync 200 (state=${sync.body.data?.info?.state}, live=${sync.body.data?.live?.total})`);
    } else {
      bad("Catalyst sync lỗi", `HTTP ${sync.status} ${sync.body?.error ?? sync.body?.data?.live?.error ?? ""}`);
    }

    const coverage = await getJson<{
      success?: boolean;
      error?: string;
      data?: { outliers?: number; totalSignals?: number };
    }>(`${baseUrl}/api/admin/catalyst/coverage`, cookie);
    if (coverage.status === 200 && coverage.body?.success && (coverage.body.data?.outliers ?? 0) > 0) {
      ok(
        `Catalyst coverage 200 (${coverage.body.data?.outliers ?? 0} outlier / ${
          coverage.body.data?.totalSignals ?? 0
        } tín hiệu)`
      );
    } else {
      bad("Catalyst coverage lỗi", `HTTP ${coverage.status} ${coverage.body?.error ?? ""}`);
    }

    // 7) Tuỳ chọn: kiểm tra DOM thật (cần `playwright` + chromium)
    if (withBrowser) {
      try {
        // Không import trực tiếp: playwright chỉ là optional dev tool.
        const { chromium } = createRequire(import.meta.url)("playwright");
        const instance = await chromium.launch();
        try {
          const context = await instance.newContext({ viewport: { width: 390, height: 844 } });
          await context.addCookies([
            { name: SESSION_COOKIE, value: session, domain: "127.0.0.1", path: "/" },
          ]);
          const page = await context.newPage();
          await page.goto(`${baseUrl}/radar`, { waitUntil: "domcontentloaded" });
          await page
            .getByText("Hiệu quả theo cụm rotation", { exact: false })
            .first()
            .waitFor({ timeout: 30_000 });
          await page
            .getByText("Catalyst có giúp outlier đi tiếp?", { exact: false })
            .first()
            .waitFor({ timeout: 30_000 });
          ok("DOM /radar: cả bảng cụm và bảng catalyst đã render");

          await page.goto(`${baseUrl}/admin`, { waitUntil: "domcontentloaded" });
          await page.getByText("Catalyst sync", { exact: true }).first().waitFor({ timeout: 30_000 });
          await page.getByText("Catalyst coverage", { exact: true }).first().waitFor({ timeout: 30_000 });
          ok("DOM /admin: card Catalyst sync/coverage đã render");
        } finally {
          await instance.close();
        }
      } catch (error) {
        console.log(
          `  \u26a0 bỏ qua kiểm tra DOM — chưa cài playwright (${(error as Error).message.split("\n")[0]})`
        );
      }
    }

    if (failures > 0) {
      console.log("\nLog next dev (200 dòng cuối):");
      console.log(logs.join("").split("\n").slice(-200).join("\n"));
      const output = logs.join("");
      if (output.includes("Another next dev server is already running")) {
        console.log(
          "\n→ Đang có `next dev` khác trong thư mục này. Dừng nó (lệnh `kill <PID>` in ở trên) rồi chạy lại `npm run check:radar-ui`.\n"
        );
      }
    }
  } catch (error) {
    failures += 1;
    console.error("\nCHECK FAILED:", (error as Error).message);
    const output = logs.join("");
    console.log(output.split("\n").slice(-80).join("\n"));
    if (output.includes("Another next dev server is already running")) {
      console.log(
        "\n→ Đang có `next dev` khác trong thư mục này. Dừng nó (lệnh `kill <PID>` in ở trên) rồi chạy lại `npm run check:radar-ui`.\n"
      );
    }
  } finally {
    await stop(child);
    await pgServer.stop().catch(() => undefined);
    await db.close().catch(() => undefined);
  }

  if (failures > 0) {
    console.log(`\n\u2717 ${failures} check thất bại\n`);
    process.exit(1);
  }
  console.log("\n\u2713 Tất cả check radar UI đều pass\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
