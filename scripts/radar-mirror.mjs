#!/usr/bin/env node
/**
 * Radar live-mirror — chạy dev server sau một MITM proxy cục bộ để verify live
 * Market Radar từ máy bị Binance Futures geo-block (HTTP 451).
 *
 * Vì sao cần: `fapi.binance.com` / `api.binance.com` trả 451 từ một số VM, trong khi
 * cùng API đó nằm sau `www.binance.com/fapi/...` và `data-api.binance.vision/api/v3/...`
 * và trả 200. Script này KHÔNG sửa source: nó chỉ chèn một proxy HTTPS ở giữa, đổi
 * host đích của request đi ra, còn path/query/payload giữ nguyên.
 *
 *   node scripts/radar-mirror.mjs setup      # tạo CA + leaf cert trong .radar-mirror/
 *   node scripts/radar-mirror.mjs verify     # kiểm tra 3 host qua proxy
 *   node scripts/radar-mirror.mjs run -- npm run dev
 *   node scripts/radar-mirror.mjs start      # chỉ chạy proxy (giữ tiến trình)
 *
 * `run` tự bật proxy rồi chạy lệnh con với HTTPS_PROXY / NODE_EXTRA_CA_CERTS /
 * NO_PROXY, và tắt proxy khi lệnh con thoát.
 *
 * Lưu ý: đây là công cụ verify read-only. Không đưa host mirror vào `src/`, không
 * dùng cho production/collector — source luôn gọi host chính thức.
 */

import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = process.cwd();
const CERT_DIR = path.join(ROOT, ".radar-mirror");
const CA_PEM = path.join(CERT_DIR, "ca.pem");
const CERT_PEM = path.join(CERT_DIR, "cert.pem");
const KEY_PEM = path.join(CERT_DIR, "key.pem");

/** Map mặc định: host bị chặn = host mirror cùng API. Ghi đè bằng RADAR_MIRROR_MAP. */
const DEFAULT_MAP =
  "fapi.binance.com=www.binance.com,api.binance.com=data-api.binance.vision";
const PORT = Number(process.env.RADAR_MIRROR_PORT || 8899);
const HOST = "127.0.0.1";

const log = (message) => console.log(`[radar-mirror] ${message}`);
const die = (message) => {
  console.error(`[radar-mirror] ${message}`);
  process.exit(1);
};

function parseMap(raw) {
  const map = new Map();
  for (const pair of String(raw).split(",")) {
    const [from, to] = pair.split("=").map((part) => part?.trim().toLowerCase());
    if (!from || !to) continue;
    map.set(from, to);
  }
  if (map.size === 0) die("RADAR_MIRROR_MAP rỗng hoặc sai định dạng host=host,host=host");
  return map;
}

/* ------------------------------------------------------------------ certs */

function sanNames(map) {
  const names = new Set(["localhost", "127.0.0.1"]);
  for (const [from, to] of map) {
    names.add(from);
    names.add(to);
  }
  return [...names];
}

function ensureCerts(map, { force = false } = {}) {
  if (!force && fs.existsSync(CA_PEM) && fs.existsSync(CERT_PEM) && fs.existsSync(KEY_PEM)) {
    return;
  }
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const names = sanNames(map);
  const san = names
    .map((name) => (/^\d+\.\d+\.\d+\.\d+$/.test(name) ? `IP:${name}` : `DNS:${name}`))
    .join(",");
  const extFile = path.join(CERT_DIR, "leaf.ext");
  const csrFile = path.join(CERT_DIR, "leaf.csr");
  fs.writeFileSync(
    extFile,
    [
      "basicConstraints=CA:FALSE",
      "keyUsage=digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth",
      `subjectAltName=${san}`,
    ].join("\n") + "\n",
  );

  log(`tạo CA + leaf cert cho: ${names.join(", ")}`);
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30",
      "-keyout", path.join(CERT_DIR, "ca.key"),
      "-out", CA_PEM,
      "-subj", "/CN=Radar Live Mirror Local CA",
    ],
    { stdio: "pipe" },
  );
  execFileSync(
    "openssl",
    [
      "req", "-newkey", "rsa:2048", "-nodes", "-keyout", KEY_PEM,
      "-out", csrFile,
      "-subj", `/CN=${map.keys().next().value || "radar-mirror"}`,
    ],
    { stdio: "pipe" },
  );
  execFileSync(
    "openssl",
    [
      "x509", "-req", "-in", csrFile, "-CA", CA_PEM,
      "-CAkey", path.join(CERT_DIR, "ca.key"), "-CAcreateserial",
      "-out", CERT_PEM, "-days", "30", "-extfile", extFile,
    ],
    { stdio: "pipe" },
  );
  fs.rmSync(csrFile, { force: true });
  log(`cert: ${path.relative(ROOT, CERT_PEM)} (CA: ${path.relative(ROOT, CA_PEM)})`);
}

/* ------------------------------------------------------------------ proxy */

function startProxy(map) {
  const tlsServer = https.createServer(
    { key: fs.readFileSync(KEY_PEM), cert: fs.readFileSync(CERT_PEM) },
    (req, res) => {
      const host = String(req.headers.host || "").split(":")[0].toLowerCase();
      const target = map.get(host);
      if (!target) {
        res.writeHead(421, { "content-type": "text/plain" });
        res.end(`radar-mirror: host ${host || "(none)"} không có trong map`);
        return;
      }
      const upstream = https.request(
        {
          host: target,
          port: 443,
          method: req.method,
          path: req.url,
          servername: target,
          headers: { ...req.headers, host: target },
        },
        (up) => {
          res.writeHead(up.statusCode || 502, up.headers);
          up.pipe(res);
        },
      );
      upstream.on("error", (error) => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
        res.end(`radar-mirror upstream error: ${error.message}`);
      });
      req.pipe(upstream);
    },
  );

  const proxy = http.createServer((_req, res) => {
    res.writeHead(405, { "content-type": "text/plain" });
    res.end("radar-mirror: chỉ nhận CONNECT");
  });

  proxy.on("connect", (req, clientSocket, head) => {
    const host = String(req.url || "").split(":")[0].toLowerCase();
    if (!map.has(host)) {
      clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head?.length) clientSocket.unshift(head);
    // https.Server tự handshake trên socket thô này.
    tlsServer.emit("connection", clientSocket);
  });

  return { proxy, tlsServer };
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    });
    server.listen(port, HOST, () => resolve(true));
  });
}

async function bootProxy(map) {
  ensureCerts(map);
  const { proxy, tlsServer } = startProxy(map);
  const started = await listen(proxy, PORT);
  if (started) {
    log(`proxy ${HOST}:${PORT} → ${[...map].map(([a, b]) => `${a}=${b}`).join(", ")}`);
  } else {
    log(`port ${PORT} đã có listener — dùng lại proxy đang chạy`);
  }
  return { proxy, tlsServer, started };
}

/* ----------------------------------------------------------------- verify */

// Phải async: proxy chạy trong chính process này, execFileSync sẽ chặn event loop
// nên proxy không kịp trả lời CONNECT (curl timeout).
async function curlThroughProxy(url) {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-sS", "-o", "/dev/null", "-w", "%{http_code}",
      "-x", `http://${HOST}:${PORT}`,
      "--cacert", CA_PEM,
      "--max-time", "20",
      url,
    ],
    { encoding: "utf8" },
  );
  return stdout.trim();
}

async function verify() {
  const map = parseMap(process.env.RADAR_MIRROR_MAP || DEFAULT_MAP);
  const { proxy, tlsServer } = await bootProxy(map);

  let failures = 0;
  const required = [
    "https://fapi.binance.com/fapi/v1/time",
    "https://api.binance.com/api/v3/time",
  ];
  for (const url of required) {
    let code = "000";
    try {
      code = await curlThroughProxy(url);
    } catch (error) {
      code = `curl: ${error.message.split("\n")[0]}`;
    }
    const pass = code === "200";
    if (!pass) failures += 1;
    console.log(`  ${pass ? "✓" : "✗"} ${url} → ${code}`);
  }

  const base = process.env.RADAR_BASE;
  if (base) {
    for (const [label, pathname] of [
      ["movers gainer", "/api/market/movers?side=gainer&limit=3"],
      ["track-record", "/api/market/radar/track-record"],
    ]) {
      try {
        const { stdout: body } = await execFileAsync(
          "curl",
          ["-sS", "--max-time", "60", `${base.replace(/\/$/, "")}${pathname}`],
          { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
        );
        const demo = /"demo"\s*:\s*true/.test(body);
        console.log(
          `  ${demo ? "!" : "✓"} ${label}: 200, demo=${demo ? "true (KHÔNG phải dữ liệu thật)" : "false"}`,
        );
        if (demo) failures += 1;
      } catch (error) {
        failures += 1;
        console.log(`  ✗ ${label}: ${error.message.split("\n")[0]}`);
      }
    }
  } else {
    log("bỏ qua kiểm tra app (đặt RADAR_BASE=http://127.0.0.1:3000 để bật)");
  }

  proxy.close();
  tlsServer.close();
  process.exit(failures === 0 ? 0 : 1);
}

/* -------------------------------------------------------------------- run */

async function run(command) {
  if (command.length === 0) die("thiếu lệnh sau `--`");
  const map = parseMap(process.env.RADAR_MIRROR_MAP || DEFAULT_MAP);
  const { proxy, tlsServer } = await bootProxy(map);

  const noProxy = ["127.0.0.1", "localhost", "::1", process.env.NO_PROXY]
    .filter(Boolean)
    .join(",");
  const child = spawn(command[0], command.slice(1), {
    stdio: "inherit",
    env: {
      ...process.env,
      HTTP_PROXY: `http://${HOST}:${PORT}`,
      HTTPS_PROXY: `http://${HOST}:${PORT}`,
      NODE_EXTRA_CA_CERTS: CA_PEM,
      // Node >= 24: global fetch chỉ đọc proxy từ env khi có cờ này (axios tự đọc).
      NODE_USE_ENV_PROXY: "1",
      NO_PROXY: noProxy,
      no_proxy: noProxy,
    },
  });

  const shutdown = () => {
    child.kill("SIGTERM");
    proxy.close();
    tlsServer.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  child.on("exit", (code, signal) => {
    proxy.close();
    tlsServer.close();
    process.exit(signal ? 1 : code ?? 0);
  });
}

/* ------------------------------------------------------------------- main */

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "setup": {
    ensureCerts(parseMap(process.env.RADAR_MIRROR_MAP || DEFAULT_MAP), {
      force: rest.includes("--force"),
    });
    break;
  }
  case "start": {
    await bootProxy(parseMap(process.env.RADAR_MIRROR_MAP || DEFAULT_MAP));
    break;
  }
  case "verify":
    await verify();
    break;
  case "run":
    await run(rest[0] === "--" ? rest.slice(1) : rest);
    break;
  default:
    console.log(
      [
        "Radar live-mirror (vượt geo-block 451 cho verify live)",
        "",
        "  node scripts/radar-mirror.mjs setup [--force]   tạo CA + leaf cert (.radar-mirror/)",
        "  node scripts/radar-mirror.mjs verify            kiểm tra host mirror qua proxy",
        "  node scripts/radar-mirror.mjs run -- <cmd>      chạy lệnh sau proxy (vd: npm run dev)",
        "  node scripts/radar-mirror.mjs start             chỉ chạy proxy ở foreground",
        "",
        `  RADAR_MIRROR_PORT=${PORT}  RADAR_MIRROR_MAP="${DEFAULT_MAP}"`,
        "  RADAR_BASE=http://127.0.0.1:3000 (tuỳ chọn, để verify thêm API radar)",
        "",
        "  Runbook: docs/RADAR-LIVE-MIRROR_RUNBOOK.md",
      ].join("\n"),
    );
    process.exit(command ? 1 : 0);
}
