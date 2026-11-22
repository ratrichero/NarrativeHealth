// TRACK-01 — Tải track record công khai (CSV mặc định, `?format=json`).
//
// Cùng một nguồn với /api/track-record (`readTrackRecord`) nên số trên trang và
// trong file không thể lệch nhau. Mỗi dòng là một pick đã chốt, kèm trạng thái
// và trạng thái khớp entry — đủ để người ngoài tự kiểm lại win rate.

import { NextRequest, NextResponse } from "next/server";
import { readTrackRecord } from "@/lib/backtest/track-record-read";

export const dynamic = "force-dynamic";

export const CSV_COLUMNS = [
  "data_date",
  "symbol",
  "direction",
  "status",
  "outcome",
  "exit_r_gross",
  "exit_r_net",
  "entry_filled",
  "evaluated_at",
] as const;

function csvCell(value: string | number | boolean | null): string {
  if (value == null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: NextRequest) {
  try {
    const read = await readTrackRecord();
    const format = (new URL(request.url).searchParams.get("format") ?? "csv").toLowerCase();
    const stamp = read.payload.meta.dataAsOf ?? read.payload.meta.generatedAt.slice(0, 10);

    if (format === "json") {
      return NextResponse.json(
        {
          success: true,
          data: {
            ...read.payload,
            /** Toàn bộ pick đã chốt — cùng tập hợp CSV xuất ra. */
            trades: read.picks,
          },
        },
        {
          headers: {
            "content-disposition": `attachment; filename="track-record-${stamp}.json"`,
            "cache-control": "no-store",
          },
        }
      );
    }

    const lines = [CSV_COLUMNS.join(",")];
    for (const pick of read.picks) {
      lines.push(
        [
          pick.dataDate,
          pick.symbol,
          pick.direction,
          pick.status,
          pick.outcome,
          pick.exitRGross,
          pick.exitRNet,
          pick.entryFilled,
          pick.evaluatedAt,
        ]
          .map(csvCell)
          .join(",")
      );
    }

    return new NextResponse(`${lines.join("\n")}\n`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="track-record-${stamp}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("[GET /api/track-record/export]", error);
    return NextResponse.json(
      { success: false, error: "Track record export failed." },
      { status: 500 }
    );
  }
}
