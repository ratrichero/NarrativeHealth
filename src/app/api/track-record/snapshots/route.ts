import { NextResponse } from "next/server";
import { readTrackRecord } from "@/lib/backtest/track-record-read";
import {
  publishDailySnapshot,
  readVerifiedSnapshotChain,
} from "@/lib/backtest/snapshot-store";
import { getBusinessDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * SNAPSHOT-01 — chuỗi bản chụp công khai.
 *
 * GET: các dòng đã chốt + kết quả kiểm hash (client tự kiểm lại được bằng
 * `verifySnapshotChain` vì payload hash nằm trong từng dòng).
 *
 * POST: chốt payload hôm nay. Idempotent theo ngày — lượt gọi sau trả dòng đã
 * có với `created: false`, không ghi đè lịch sử đã công bố.
 */
export async function GET(request: Request) {
  const limit = new URL(request.url).searchParams.get("limit");
  try {
    const chain = await readVerifiedSnapshotChain(limit ? Number(limit) : undefined);
    return NextResponse.json({
      success: true,
      data: {
        entries: chain.entries,
        verification: chain.verification,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.warn(
      "[SNAPSHOT-01] Không đọc được chuỗi bản chụp (đã chạy migration 0040?):",
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json(
      { success: false, error: "Không đọc được chuỗi bản chụp." },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const { payload } = await readTrackRecord();
    const day = payload.meta.dataAsOf ?? getBusinessDate();
    const result = await publishDailySnapshot(payload, day, payload.meta.metricsVersion);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.warn(
      "[SNAPSHOT-01] Không chốt được bản chụp:",
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json(
      { success: false, error: "Không chốt được bản chụp." },
      { status: 500 }
    );
  }
}
