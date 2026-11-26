// SNAPSHOT-02-PUBLIC — payload công khai của MỘT ngày đã chốt.
//
// `/api/track-record/snapshots` (GET) chỉ trả hash + ngày, nên muốn kiểm lại
// `payload_hash` thì phải có payload — mà payload chỉ nằm trong DB. Endpoint
// này là mảnh còn thiếu: trả payload đã chốt kèm hai hash và `prevHead` (đầu
// vào của neo), để bất kỳ ai cũng tự tính lại được:
//
//   payloadHash = sha256("v<schema>|" + canonicalJson(payload))
//   headHash    = sha256("head-v1|<day>|<payloadHash>|<prevHead>")
//
// rồi so `headHash` với con số đã neo ra ngoài (tin nhắn `[SNAPSHOT-ANCHOR]`,
// log scheduler, commit). Không có bí mật nào ở đây: đây chính là thứ được
// công bố, chỉ là trước đó không ai đọc được.
//
// Vì sao có ETag: bản chụp là append-only — một ngày đã chốt thì payload không
// bao giờ đổi nữa. ETag mạnh = `payload_hash` (định danh chính xác nội dung),
// nên client verify hàng loạt chỉ tải mỗi ngày một lần; `If-None-Match` trả 304.
// Vì sao có rate limit: payload là full JSON của track record, nặng hơn list —
// trần riêng theo IP (`RADAR_SNAPSHOT_PAYLOAD_PER_IP_PER_MIN`, mặc định 30/phút).

import { NextRequest, NextResponse } from "next/server";
import { SNAPSHOT_SCHEMA_VERSION } from "@/lib/backtest/snapshot";
import { readSnapshotPayloadBundle } from "@/lib/backtest/snapshot-store";
import {
  clientIpFromHeaders,
  rateLimitHeaders,
  snapshotPayloadLimiter,
} from "@/lib/market/rate-limit";

export const dynamic = "force-dynamic";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Ngày đã chốt không bao giờ đổi → cache được vô hạn; `immutable` cắt revalidate. */
const CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Quy tắc băm trả kèm payload. Người ngoài đọc được luật ngay trong response,
 * không phải tìm source: script `scripts/verify-snapshot.mjs` dùng đúng các
 * chuỗi này.
 */
const hashRules = {
  algorithm: "sha256",
  /** Luật băm của bản chốt MỚI; dòng cũ dùng `data.schemaVersion` của nó. */
  schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  payloadHash: `sha256("v${SNAPSHOT_SCHEMA_VERSION}|" + canonicalJson(payload))`,
  headHash: `sha256("head-v1|" + day + "|" + payloadHash + "|" + prevHead)`,
  canonicalJson:
    "object keys sorted recursively; undefined dropped; arrays keep order; non-finite numbers and non-JSON values → null",
  genesisPrevHead: "0".repeat(64),
};

/** So `If-None-Match` với ETag mạnh của bản chụp (chấp nhận list + `W/`). */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((part) => part.trim().replace(/^W\//, ""))
    .some((candidate) => candidate === etag || candidate === "*");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ day: string }> }
) {
  const { day } = await params;

  if (!DAY_PATTERN.test(day)) {
    return NextResponse.json(
      { success: false, error: "Ngày phải có dạng YYYY-MM-DD." },
      { status: 400 }
    );
  }

  const limit = snapshotPayloadLimiter.check(clientIpFromHeaders(request.headers));
  const limitHeaders = rateLimitHeaders(limit);
  if (!limit.allowed) {
    return NextResponse.json(
      { success: false, error: "Quá nhiều yêu cầu — thử lại sau." },
      { status: 429, headers: limitHeaders }
    );
  }

  try {
    const bundle = await readSnapshotPayloadBundle(day);
    if (!bundle) {
      return NextResponse.json(
        { success: false, error: `Ngày ${day} chưa có bản chụp nào.` },
        { status: 404, headers: limitHeaders }
      );
    }

    // ETag mạnh từ payload_hash: cùng payload → cùng ETag, kể cả khác instance.
    const etag = `"${bundle.entry.payloadHash}"`;
    const headers = { ...limitHeaders, ETag: etag, "Cache-Control": CACHE_CONTROL };

    if (etagMatches(request.headers.get("if-none-match"), etag)) {
      return new NextResponse(null, { status: 304, headers });
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          day: bundle.entry.day,
          payloadHash: bundle.entry.payloadHash,
          headHash: bundle.entry.headHash,
          prevHead: bundle.prevHead,
          // Luật băm của CHÍNH dòng này: dòng chốt trước v2 không có
          // `snapshot.capturedAt` và phải được băm bằng `v1|`. Client dùng số
          // này thay cho `hashRules.schemaVersion` (luật của bản chốt mới).
          schemaVersion: bundle.entry.schemaVersion,
          metricsVersion: bundle.entry.metricsVersion,
          createdAt: bundle.entry.createdAt,
          payload: bundle.payload,
          hashRules,
          generatedAt: new Date().toISOString(),
        },
      },
      { headers }
    );
  } catch (error) {
    console.warn(
      "[SNAPSHOT-02] Không đọc được payload bản chụp (đã chạy migration 0040 + 0041?):",
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json(
      { success: false, error: "Không đọc được payload bản chụp." },
      { status: 500, headers: limitHeaders }
    );
  }
}
