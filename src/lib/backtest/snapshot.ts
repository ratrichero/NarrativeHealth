// SNAPSHOT-01 — bản chụp công khai theo ngày + chuỗi hash nối tiếp.
//
// Track record hiện tại là một payload *tính lại mỗi lần đọc*: cùng một ngày có
// thể cho hai con số khác nhau sau khi sửa cost, settlement hoặc horizon — và
// không ai chứng minh được con số hôm qua đã từng đúng. Bản chụp chốt payload
// của một ngày thành một dòng bất biến, mỗi dòng mang hash của chính payload và
// hash của dòng trước. Sửa một dòng trong quá khứ làm gãy chuỗi ngay tại đó.
//
// Thuần (chỉ dùng crypto để băm) → test được không cần DB. Phần đọc/ghi ở
// `snapshot-store.ts`.

import { createHash } from "node:crypto";

/** Tăng khi cách băm/định dạng payload đổi — khác version thì không so chuỗi. */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/** `prevHash` của dòng đầu tiên: 64 số 0, không phải null, để cột NOT NULL. */
export const SNAPSHOT_GENESIS_HASH = "0".repeat(64);

/**
 * JSON canonical: object key sắp xếp đệ quy, `undefined` bị bỏ, mảng giữ thứ
 * tự. Hash chỉ có nghĩa khi cùng dữ liệu luôn cho cùng chuỗi byte — thứ tự key
 * của `JSON.stringify` phụ thuộc cách object được dựng, nên không dùng trực tiếp.
 */
export function canonicalJson(value: unknown): string {
  const encode = (node: unknown): string => {
    if (node === null) return "null";
    if (node === undefined) return "null";
    const type = typeof node;
    if (type === "number") return Number.isFinite(node as number) ? String(node) : "null";
    if (type === "boolean") return node ? "true" : "false";
    if (type === "string") return JSON.stringify(node);
    if (Array.isArray(node)) return `[${node.map(encode).join(",")}]`;
    if (type === "object") {
      const record = node as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${encode(record[key])}`).join(",")}}`;
    }
    // bigint/function/symbol không có trong payload JSON; đưa về null thay vì
    // làm hash phụ thuộc môi trường.
    return "null";
  };
  return encode(value);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Hash của payload đã chụp (không gồm metadata của chính bản chụp). */
export function snapshotPayloadHash(payload: unknown): string {
  return sha256Hex(`v${SNAPSHOT_SCHEMA_VERSION}|${canonicalJson(payload)}`);
}

export interface SnapshotHashInput {
  /** Ngày dữ liệu (YYYY-MM-DD) — khoá tự nhiên của bản chụp. */
  day: string;
  payloadHash: string;
  metricsVersion: string;
  prevHash: string;
}

export interface SnapshotEntry extends SnapshotHashInput {
  hash: string;
  /** Số thứ tự trong chuỗi (1 = dòng đầu). */
  sequence: number;
  createdAt: string;
}

/**
 * Hash của một dòng = băm (day, payloadHash, version, prevHash). Gồm `prevHash`
 * nên đổi một dòng cũ làm mọi hash sau nó sai theo — đó là mục đích.
 */
export function computeSnapshotHash(input: SnapshotHashInput): string {
  return sha256Hex(
    [
      `v${SNAPSHOT_SCHEMA_VERSION}`,
      input.day,
      input.metricsVersion,
      input.payloadHash,
      input.prevHash,
    ].join("|")
  );
}

export function buildSnapshotEntry(
  input: SnapshotHashInput,
  options: { sequence?: number; createdAt?: string } = {}
): SnapshotEntry {
  return {
    ...input,
    hash: computeSnapshotHash(input),
    sequence: options.sequence ?? 1,
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
}

export type ChainBreakReason =
  | "sequence-gap"
  | "prev-hash-mismatch"
  | "hash-mismatch"
  | "day-not-increasing"
  | "payload-hash-mismatch";

export interface ChainVerification {
  ok: boolean;
  brokenAtIndex: number | null;
  reason: ChainBreakReason | null;
  /** Số dòng đã kiểm trước khi dừng. */
  checked: number;
}

/**
 * Kiểm chuỗi theo thứ tự tăng dần. `payloads` (tuỳ chọn) là payload gốc cùng
 * thứ tự để phát hiện cả trường hợp payload bị sửa mà hash dòng vẫn khớp.
 */
export function verifySnapshotChain(
  entries: readonly SnapshotEntry[],
  payloads?: readonly unknown[]
): ChainVerification {
  let previous: SnapshotEntry | null = null;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (previous) {
      if (entry.sequence !== previous.sequence + 1) {
        return { ok: false, brokenAtIndex: index, reason: "sequence-gap", checked: index };
      }
      if (entry.prevHash !== previous.hash) {
        return { ok: false, brokenAtIndex: index, reason: "prev-hash-mismatch", checked: index };
      }
      if (entry.day <= previous.day) {
        return { ok: false, brokenAtIndex: index, reason: "day-not-increasing", checked: index };
      }
    } else if (entry.sequence === 1 && entry.prevHash !== SNAPSHOT_GENESIS_HASH) {
      // Dòng đầu của chuỗi phải nối genesis. Kiểm TRƯỚC khi tính hash: prevHash
      // sai làm hash cũng lệch, và "hash-mismatch" sẽ che mất nguyên nhân thật.
      // Chuỗi đọc một phần (bắt đầu ở sequence > 1) vẫn hợp lệ với prevHash thật.
      return { ok: false, brokenAtIndex: index, reason: "prev-hash-mismatch", checked: index };
    }
    const recomputed = computeSnapshotHash({
      day: entry.day,
      payloadHash: entry.payloadHash,
      metricsVersion: entry.metricsVersion,
      prevHash: entry.prevHash,
    });
    if (recomputed !== entry.hash) {
      return { ok: false, brokenAtIndex: index, reason: "hash-mismatch", checked: index };
    }
    if (payloads && payloads[index] !== undefined) {
      if (snapshotPayloadHash(payloads[index]) !== entry.payloadHash) {
        return { ok: false, brokenAtIndex: index, reason: "payload-hash-mismatch", checked: index };
      }
    }
    previous = entry;
  }
  return { ok: true, brokenAtIndex: null, reason: null, checked: entries.length };
}
