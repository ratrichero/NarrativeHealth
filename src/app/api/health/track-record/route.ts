import { NextResponse } from "next/server";
import { preflightTrackRecordSchema } from "@/lib/db/preflight";
import { readTrackRecord } from "@/lib/backtest/track-record-read";
import { SNAPSHOT_SCHEMA_VERSION } from "@/lib/backtest/snapshot";
import {
  listSnapshotGaps,
  readSnapshotDayStatus,
  readSnapshotEntries,
  readSnapshotFreshness,
} from "@/lib/backtest/snapshot-store";
import { getBusinessDate, getYesterdayBusinessDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "warn" | "fail";

interface HealthCheck {
  id: string;
  status: CheckStatus;
  detail: string;
}

/**
 * HEALTH-TRACK-01 — healthcheck cho track record, đọc bằng máy.
 *
 * Trang công khai đã có banner cho người đọc; uptime monitor cần một chỗ trả
 * lời được "track record này còn sống không" mà không phải parse HTML. Các
 * trạng thái dưới đây đều là thứ đã từng âm thầm sai: schema thiếu cột sau
 * deploy sai thứ tự, LIVE_SINCE sai định dạng, origin không bao giờ live, pick
 * chờ chốt quá hạn, hoặc cửa sổ đọc bị cắt.
 *
 * 503 chỉ khi có `fail` (schema thiếu cột) — cảnh báo vẫn trả 200 để monitor
 * phân biệt "hỏng" với "cần xem".
 */
export async function GET() {
  const checks: HealthCheck[] = [];

  const schema = await preflightTrackRecordSchema();
  checks.push({
    id: "schema",
    status: schema.ok ? "ok" : "fail",
    detail: schema.ok
      ? "Đủ cột cho code hiện tại."
      : `${schema.action ?? "Thiếu cột."}${
          schema.missing.length
            ? ` Thiếu: ${schema.missing.map((m) => `${m.table}.${m.column}`).join(", ")}`
            : ""
        }`,
  });

  let payload: Awaited<ReturnType<typeof readTrackRecord>>["payload"] | null = null;
  let readError: string | null = null;
  try {
    payload = (await readTrackRecord()).payload;
  } catch (error) {
    readError = error instanceof Error ? error.message : String(error);
  }

  if (!payload) {
    checks.push({
      id: "read",
      status: "fail",
      detail: `Không dựng được payload: ${readError ?? "unknown"}`,
    });
    return NextResponse.json(
      { ok: false, checks, generatedAt: new Date().toISOString() },
      { status: 503 }
    );
  }

  checks.push({
    id: "read",
    status: "ok",
    detail: `Đọc ${payload.summary.totals.picks} pick đã chốt.`,
  });

  checks.push({
    id: "freshness",
    status: payload.freshness.stale ? "warn" : "ok",
    detail: payload.freshness.stale
      ? `Dữ liệu không còn cập nhật (${payload.freshness.reason}); pick mới nhất cách hôm nay ${payload.freshness.pickAgeDays ?? "?"} ngày.`
      : "Dữ liệu còn cập nhật.",
  });

  checks.push({
    id: "live-since",
    status:
      payload.split.liveSinceSource === "invalid-env"
        ? "fail"
        : payload.split.liveSinceSource === "derived"
          ? "warn"
          : "ok",
    detail:
      payload.split.liveSinceSource === "invalid-env"
        ? "LIVE_SINCE có nhưng sai định dạng YYYY-MM-DD — mốc live đang bị suy ra."
        : payload.split.liveSinceSource === "derived"
          ? `LIVE_SINCE chưa đặt; mốc live suy từ pick forward sớm nhất (${payload.split.liveSince ?? "—"}).`
          : `Mốc live: ${payload.split.liveSince ?? "chưa có"}.`,
  });

  checks.push({
    id: "origin",
    status: payload.split.originSignal ? "warn" : "ok",
    detail: payload.split.originSignal
      ? `Mọi pick đã chốt đều backfill trong ngưỡng lag (${payload.split.originSignal.withinGracePicks} pick) — pipeline có thể luôn chậm một ngày.`
      : "Origin có ít nhất một pick forward hoặc có backfill thật.",
  });

  const today = getBusinessDate();
  const overdue =
    payload.settlement.pendingPicks > 0 &&
    payload.settlement.nextSettlementAt != null &&
    payload.settlement.nextSettlementAt < today;
  checks.push({
    id: "settlement",
    status: overdue ? "warn" : "ok",
    detail:
      payload.settlement.pendingPicks === 0
        ? "Không còn pick chờ chốt."
        : overdue
          ? `${payload.settlement.pendingPicks} pick chờ, hạn chốt sớm nhất ${payload.settlement.nextSettlementAt} đã qua.`
          : `${payload.settlement.pendingPicks} pick chờ, chốt từ ${payload.settlement.nextSettlementAt ?? "—"}.`,
  });

  checks.push({
    id: "window",
    status: payload.meta.window.capped ? "warn" : "ok",
    detail: payload.meta.window.capped
      ? `Lịch sử bị cắt ở ${payload.meta.window.limit} dòng; phần forward đọc riêng nên không bị cắt.`
      : `Đọc đủ ${payload.meta.window.rowsRead} dòng.`,
  });

  // SNAPSHOT-02: bản chụp phải được job trong /api/refresh chốt mỗi ngày. Kiểm
  // cả ba thứ: có bản chụp của ngày vừa đóng không, payload còn khớp
  // `payload_hash` không, và `head_hash` có nối đúng bản trước không (bắt được
  // sửa head mà băm payload không thấy). Thiếu bản chụp là `warn` — có thể job
  // chưa chạy hôm nay; lệch hash là `fail` vì dữ liệu đã công bố bị sửa.
  const snapshotDay = getYesterdayBusinessDate();
  try {
    const status = await readSnapshotDayStatus(snapshotDay);
    // Ngày đã đóng mà không có bản chụp: không còn chốt bù nên chúng thiếu vĩnh
    // viễn. Phải hiện ra ở đây, nếu không chúng mất âm thầm.
    const gaps = await listSnapshotGaps({ today: getBusinessDate() });
    const missing = gaps.missing;
    const missingDetail =
      missing.length > 0
        ? ` ${missing.length} ngày đã đóng trong ${gaps.windowDays} ngày gần nhất KHÔNG có bản chụp (không chốt bù — số hiện tại không phải số của ngày đó): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? " (chỉ liệt kê 10 ngày gần nhất)" : ""}.`
        : "";
    if (!status.entry) {
      checks.push({
        id: "snapshot",
        status: "warn",
        detail: `Chưa có bản chụp cho ${snapshotDay} — job chốt trong /api/refresh có thể chưa chạy hoặc đang lỗi.${missingDetail}`
      });
    } else if (status.payloadMatches === false) {
      checks.push({
        id: "snapshot",
        status: "fail",
        detail: `Bản chụp ${snapshotDay} KHÔNG khớp payload_hash đã công bố — payload trong DB đã bị sửa.`,
      });
    } else if (status.headLinked === false) {
      checks.push({
        id: "snapshot",
        status: "fail",
        detail: `Bản chụp ${snapshotDay}: head_hash không nối đúng neo của bản trước (${status.previousDay ?? "genesis"}) — head trong DB đã bị sửa.`,
      });
    } else if (missing.length > 0) {
      checks.push({
        id: "snapshot",
        status: "warn",
        detail: `Bản chụp ${snapshotDay}: payload khớp hash, head nối đúng (${status.entry.headHash.slice(0, 12)}…).${missingDetail}`,
      });
    } else {
      checks.push({
        id: "snapshot",
        status: "ok",
        detail: `Bản chụp ${snapshotDay}: payload khớp hash, head nối đúng (${status.entry.headHash.slice(0, 12)}…).`,
      });
    }
  } catch (error) {
    checks.push({
      id: "snapshot",
      status: "fail",
      detail: `Không đọc được bản chụp (đã chạy migration 0040 + 0041?): ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // WATCHDOG-SNAPSHOT: bản chụp mới nhất đã trễ bao nhiêu ngày. Check `snapshot`
  // ở trên chỉ nói về hôm qua và gap chỉ chạy trong lượt refresh — nếu cả
  // refresh chết thì không lượt nào tính gap. Phép đo này chỉ đọc một dòng nên
  // uptime monitor gọi được liên tục, và nó phải nói ra trước khi có người mở web.
  try {
    const latest = await readSnapshotFreshness({ today });
    if (latest.stale) {
      checks.push({
        id: "snapshot-freshness",
        status: "warn",
        detail: `Bản chụp mới nhất là ${latest.tipDay}, trong khi ngày đã đóng gần nhất là ${latest.expectedDay} (${latest.ageDays} ngày, ngưỡng ${latest.maxAgeDays}) — refresh/chốt có thể đã ngừng chạy.`,
      });
    } else if (latest.tipDay === null) {
      checks.push({
        id: "snapshot-freshness",
        status: "ok",
        detail: "Chưa có bản chụp nào (deployment mới) — chưa có gì để đo độ trễ.",
      });
    } else {
      checks.push({
        id: "snapshot-freshness",
        status: "ok",
        detail: `Bản chụp mới nhất ${latest.tipDay}, cách ngày đã đóng gần nhất ${latest.ageDays} ngày (ngưỡng ${latest.maxAgeDays}).`,
      });
    }
  } catch (error) {
    checks.push({
      id: "snapshot-freshness",
      status: "warn",
      detail: `Không đo được độ trễ bản chụp: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // SNAPSHOT-CONFIG: bản chụp sinh bởi bản code/luật băm cũ. Không phải lỗi dữ
  // liệu (dòng v1 vẫn verify đúng bằng luật v1), nhưng so sánh số giữa hai
  // metricsVersion hoặc đọc `capturedAt` từ dòng v1 sẽ sai. Báo để người vận
  // hành biết trước khi so sánh.
  try {
    const recent = await readSnapshotEntries(1);
    const newest = recent.length > 0 ? recent[recent.length - 1] : null;
    if (!newest) {
      checks.push({
        id: "snapshot-config",
        status: "ok",
        detail: "Chưa có bản chụp nào để đối chiếu cấu hình.",
      });
    } else if (newest.schemaVersion < SNAPSHOT_SCHEMA_VERSION) {
      checks.push({
        id: "snapshot-config",
        status: "warn",
        detail: `Bản chụp mới nhất ${newest.day} theo luật băm v${newest.schemaVersion} (thiếu snapshot.capturedAt trong payload_hash); code hiện tại chốt v${SNAPSHOT_SCHEMA_VERSION} — verify phải dùng schemaVersion của từng dòng.`,
      });
    } else if (newest.metricsVersion !== payload.meta.metricsVersion) {
      checks.push({
        id: "snapshot-config",
        status: "warn",
        detail: `Bản chụp ${newest.day} ghi metricsVersion ${newest.metricsVersion}, code hiện tại ${payload.meta.metricsVersion} — số đã công bố sinh bởi bản code khác, đối chiếu trước khi so sánh.`,
      });
    } else {
      checks.push({
        id: "snapshot-config",
        status: "ok",
        detail: `Bản chụp ${newest.day}: luật băm v${newest.schemaVersion}, metricsVersion ${newest.metricsVersion} khớp code hiện tại.`,
      });
    }
  } catch (error) {
    checks.push({
      id: "snapshot-config",
      status: "warn",
      detail: `Không đọc được bản chụp mới nhất: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  const ok = checks.every((check) => check.status !== "fail");
  return NextResponse.json(
    {
      ok,
      status: ok ? "healthy" : "unhealthy",
      checks,
      metricsVersion: payload.meta.metricsVersion,
      generatedAt: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
