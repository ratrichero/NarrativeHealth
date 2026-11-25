#!/usr/bin/env node
// SNAPSHOT-02-VERIFY — kiểm độc lập bản chụp track record, KHÔNG cần tin app.
//
// Công cụ này cố tình tự chứa: chỉ Node >= 18 (fetch + node:crypto), không
// import gì từ repo, không cần cài package. Người ngoài copy một file là chạy
// được — đó là điểm của nó.
//
// Nó làm đúng ba việc:
//   1. Tải payload của từng ngày qua GET /api/track-record/snapshots/<ngày>.
//   2. Tự băm lại payload → so với `payloadHash` đã công bố (bắt payload bị đổi),
//      và kiểm payload còn mang `snapshot.capturedAt` (v2) — thời điểm chụp nằm
//      trong hash, không phải ở cột `created_at` sửa được.
//   3. Tự tính lại `headHash = sha256("head-v1|day|payloadHash|prevHead")` và so
//      với head ĐÃ NEO NGOÀI (`--head`, hoặc dòng `[SNAPSHOT-ANCHOR]` trong
//      log/tin nhắn qua `--anchor-file`). Đây mới là phần chống sửa lịch sử:
//      hash trong DB tự nó không chứng minh được gì.
//
// Dùng:
//   node scripts/verify-snapshot.mjs --base-url https://example.com
//   node scripts/verify-snapshot.mjs --base-url https://example.com --head <hash>
//   node scripts/verify-snapshot.mjs --anchor-file anchors.log --days 90
//   node scripts/verify-snapshot.mjs --day 2026-11-23 --base-url ...   (một ngày)
//
// Thoát 0 = mọi thứ khớp; 1 = có ít nhất một chỗ lệch (in rõ chỗ nào).

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const GENESIS_PREV_HEAD = "0".repeat(64);
const DEFAULT_DAYS = 30;

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[arg.slice(2)] = next;
        i += 1;
      } else {
        flags[arg.slice(2)] = true;
      }
    }
  }
  return flags;
}

/** PHẢI giống canonicalJson trong src/lib/backtest/snapshot.ts từng byte. */
function canonicalJson(value) {
  const encode = (node) => {
    if (node === null || node === undefined) return "null";
    const type = typeof node;
    if (type === "number") return Number.isFinite(node) ? String(node) : "null";
    if (type === "boolean") return node ? "true" : "false";
    if (type === "string") return JSON.stringify(node);
    if (Array.isArray(node)) return `[${node.map(encode).join(",")}]`;
    if (type === "object") {
      const keys = Object.keys(node)
        .filter((key) => node[key] !== undefined)
        .sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${encode(node[key])}`).join(",")}}`;
    }
    return "null";
  };
  return encode(value);
}

function sha256Hex(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function payloadHashOf(payload, schemaVersion) {
  return sha256Hex(`v${schemaVersion}|${canonicalJson(payload)}`);
}

function headHashOf(day, payloadHash, prevHead) {
  return sha256Hex(`head-v1|${day}|${payloadHash}|${prevHead}`);
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const body = await response.text();
  let parsed = null;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    throw new Error(`${url} trả JSON không đọc được (HTTP ${response.status})`);
  }
  if (!response.ok) {
    throw new Error(
      `${url} → HTTP ${response.status}${parsed?.error ? `: ${parsed.error}` : ""}`
    );
  }
  return parsed;
}

/** Dòng neo dạng `[SNAPSHOT-ANCHOR] day=… payloadHash=… head=…` → Map theo ngày. */
function parseAnchorLines(text) {
  const anchors = new Map();
  for (const line of text.split("\n")) {
    if (!line.includes("[SNAPSHOT-ANCHOR]")) continue;
    const day = /day=(\d{4}-\d{2}-\d{2})/.exec(line)?.[1];
    const payloadHash = /payloadHash=([0-9a-f]{64})/.exec(line)?.[1];
    const head = /head=([0-9a-f]{64})/.exec(line)?.[1];
    if (!day || !payloadHash || !head) continue;
    // Lần neo sau (nếu có) thắng: đó là bản đã gửi ra ngoài muộn nhất.
    anchors.set(day, { payloadHash, head });
  }
  return anchors;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const baseUrl = String(
    flags["base-url"] ?? process.env.NARRATIVEHEALTH_BASE_URL ?? "http://localhost:3000"
  ).replace(/\/+$/, "");
  const days = Number(flags.days ?? DEFAULT_DAYS);
  const failures = [];
  const notes = [];

  const fail = (day, message) => failures.push(`${day}: ${message}`);

  let anchors = new Map();
  if (typeof flags["anchor-file"] === "string") {
    anchors = parseAnchorLines(await readFile(flags["anchor-file"], "utf8"));
    if (anchors.size === 0) {
      console.warn(`[cảnh báo] ${flags["anchor-file"]} không có dòng [SNAPSHOT-ANCHOR] nào.`);
    }
  }
  const anchoredHead = typeof flags.head === "string" ? flags.head : null;
  const singleDay = typeof flags.day === "string" ? flags.day : null;

  let list = null;
  if (!singleDay) {
    list = await getJson(
      `${baseUrl}/api/track-record/snapshots?limit=${Number.isFinite(days) ? days : DEFAULT_DAYS}`
    );
  }

  const entries = singleDay
    ? [{ day: singleDay }]
    : (list?.data?.entries ?? []);

  if (entries.length === 0) {
    console.error(`Không có bản chụp nào để kiểm ở ${baseUrl}.`);
    return 1;
  }

  console.log(`Kiểm ${entries.length} bản chụp tại ${baseUrl}`);
  let previous = null;
  let last = null;

  for (const listed of entries) {
    const day = listed.day;
    let bundle;
    try {
      const response = await getJson(`${baseUrl}/api/track-record/snapshots/${day}`);
      bundle = response.data;
    } catch (error) {
      fail(day, `không tải được payload (${error.message})`);
      continue;
    }

    // Dùng đúng phiên bản băm mà API công bố đã sinh hash; in ra để người đọc
    // biết mình đang kiểm theo luật nào.
    const schemaVersion = bundle.hashRules?.schemaVersion ?? 1;
    const capturedAt =
      bundle.payload && typeof bundle.payload === "object"
        ? bundle.payload.snapshot?.capturedAt
        : undefined;

    // 0. v2: payload phải mang `snapshot.capturedAt`; thiếu nghĩa là field đã bị
    // bỏ khỏi payload (hoặc dòng cũ trước khi bump schema).
    if (schemaVersion >= 2 && typeof capturedAt !== "string") {
      fail(
        day,
        "payload thiếu snapshot.capturedAt — thời điểm chụp phải nằm trong payload_hash"
      );
    }

    // 1. Payload tự băm phải khớp `payloadHash` đã công bố.
    const recomputedPayloadHash = payloadHashOf(bundle.payload, schemaVersion);
    if (recomputedPayloadHash !== bundle.payloadHash) {
      fail(
        day,
        `payloadHash lệch — DB/API công bố ${bundle.payloadHash}, tự băm được ${recomputedPayloadHash}`
      );
    }
    if (listed.payloadHash && listed.payloadHash !== bundle.payloadHash) {
      fail(day, `payloadHash trong list (${listed.payloadHash}) khác bundle (${bundle.payloadHash})`);
    }

    // 2. Neo: head tính từ (ngày, payloadHash tự băm, prevHead) phải khớp head công bố.
    const recomputedHead = headHashOf(day, recomputedPayloadHash, bundle.prevHead);
    if (recomputedHead !== bundle.headHash) {
      fail(
        day,
        `headHash lệch — công bố ${bundle.headHash}, tự tính được ${recomputedHead}`
      );
    }
    if (listed.headHash && listed.headHash !== bundle.headHash) {
      fail(day, `headHash trong list (${listed.headHash}) khác bundle (${bundle.headHash})`);
    }

    // 3. Chuỗi liền mạch: prevHead của ngày này phải là head của ngày trước.
    if (previous && bundle.prevHead !== previous.headHash) {
      fail(day, `prevHead (${bundle.prevHead}) không nối vào head ngày ${previous.day}`);
    }
    if (!previous && singleDay && bundle.prevHead !== GENESIS_PREV_HEAD) {
      notes.push(`ngày ${day} không phải bản đầu (prevHead khác genesis) — chuỗi trước đó không kiểm trong lượt này`);
    }

    // 4. So với bản ĐÃ NEO NGOÀI, nếu có.
    const anchor = anchors.get(day);
    if (anchor) {
      if (anchor.payloadHash !== bundle.payloadHash) {
        fail(day, `payloadHash khác bản đã neo (${anchor.payloadHash} → ${bundle.payloadHash})`);
      }
      if (anchor.head !== bundle.headHash) {
        fail(day, `headHash khác bản đã neo (${anchor.head} → ${bundle.headHash})`);
      }
    }

    console.log(
      `  OK ${day}  payloadHash=${recomputedPayloadHash.slice(0, 12)}…  head=${recomputedHead.slice(0, 12)}…  captured=${
        typeof capturedAt === "string" ? capturedAt : "—"
      }${anchor ? "  [đã đối chiếu neo]" : ""}`
    );
    previous = { day, headHash: bundle.headHash };
    last = { day, headHash: bundle.headHash, bundle };
  }

  if (anchoredHead) {
    if (!last) {
      fail("(toàn bộ)", "không kiểm được ngày nào nên không so được --head");
    } else if (last.headHash !== anchoredHead) {
      fail(last.day, `head cuối (${last.headHash}) khác head đã neo (${anchoredHead})`);
    } else {
      console.log(`  OK head cuối khớp head đã neo: ${anchoredHead}`);
    }
  }

  for (const note of notes) console.warn(`[ghi chú] ${note}`);

  if (!anchors.size && !anchoredHead) {
    console.warn(
      "[cảnh báo] Không có head neo ngoài (--head hoặc --anchor-file). Phần payload hash vẫn kiểm được,\n" +
        "nhưng KHÔNG chứng minh được lịch sử chưa bị viết lại: dùng head đã gửi tới kênh alert/log scheduler."
    );
  }

  if (failures.length > 0) {
    console.error(`\nTHẤT BẠI — ${failures.length} vấn đề:`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    return 1;
  }

  console.log(`\nTẤT CẢ KHỚP — ${entries.length} ngày kiểm xong.`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`Lỗi: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
