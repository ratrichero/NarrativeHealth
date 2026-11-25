// SNAPSHOT-02 — bước snapshot của một lượt refresh, tách khỏi route để test.
//
// Hai việc ĐỘC LẬP:
//  1. Chốt ngày vừa đóng — chỉ khi settlement sạch. Settlement hỏng thì số chưa
//     chốt hết, đóng băng bây giờ là đóng băng số dở.
//  2. Báo gap — LUÔN chạy, kể cả khi settlement hỏng hoặc bước chốt ném lỗi.
//     Ngày thiếu là chuyện của bảng append-only, không phải của lượt settlement
//     vừa hỏng; bỏ qua cả hai khi settlement lỗi sẽ làm log im lặng đúng lúc
//     cần nói nhất.
//
// Không bao giờ ném lỗi ra ngoài: refresh không được chết vì snapshot.

import { getBusinessDate, getYesterdayBusinessDate } from "@/lib/utils";
import type { TrackRecordRead } from "./track-record-read";
import { readTrackRecord } from "./track-record-read";
import type { SnapshotDayDecision } from "./snapshot";
import {
  alertSnapshotGaps,
  type SnapshotGapAlertOutcome,
} from "./snapshot-gap-alert";
import {
  listSnapshotGaps,
  publishClosedDaySnapshot,
  type SnapshotGapReport,
} from "./snapshot-store";

export type SnapshotSealStatus = "sealed" | "already-sealed" | "skipped" | "error";

export interface RefreshSnapshotOutcome {
  /** Kết quả bước chốt; "skipped" = settlement lỗi hoặc cổng ngày đóng từ chối. */
  seal: SnapshotSealStatus;
  /** Quyết định của cổng ngày đóng/settlement; null khi bỏ qua vì settlement lỗi. */
  decision: SnapshotDayDecision | null;
  /** Kết quả đọc gap; null khi chính bước đọc gap ném lỗi. */
  gaps: SnapshotGapReport | null;
  /** Kết quả gửi cảnh báo; null khi không có gap hoặc không đọc được gap. */
  alert: SnapshotGapAlertOutcome | null;
}

export interface RefreshSnapshotDeps {
  readTrackRecord: () => Promise<TrackRecordRead>;
  publishClosedDaySnapshot: typeof publishClosedDaySnapshot;
  listSnapshotGaps: (options: { today: string }) => Promise<SnapshotGapReport>;
  alertSnapshotGaps: (
    report: SnapshotGapReport,
    options: { today: string }
  ) => Promise<SnapshotGapAlertOutcome>;
  today: () => string;
  yesterday: () => string;
}

const DEFAULT_DEPS: RefreshSnapshotDeps = {
  readTrackRecord,
  publishClosedDaySnapshot,
  listSnapshotGaps,
  alertSnapshotGaps,
  today: getBusinessDate,
  yesterday: getYesterdayBusinessDate,
};

/**
 * Chạy bước chốt + báo gap của một lượt refresh.
 *
 * `settleErrors` chỉ chặn bước CHỐT. Bước gap luôn chạy để ngày đã đóng mà
 * không có bản chụp vẫn được nói ra (log + kênh alert) ngay trong lượt refresh
 * mà settlement hỏng.
 */
export async function runRefreshSnapshotStep(options: {
  settleErrors: number;
  deps?: Partial<RefreshSnapshotDeps>;
}): Promise<RefreshSnapshotOutcome> {
  const deps: RefreshSnapshotDeps = { ...DEFAULT_DEPS, ...options.deps };
  let seal: SnapshotSealStatus = "skipped";
  let decision: SnapshotDayDecision | null = null;

  if (options.settleErrors > 0) {
    // Settlement hỏng → số chưa chốt hết, đóng băng bây giờ là đóng băng số dở.
    console.warn(
      `[SNAPSHOT-02] skip seal: settlement có ${options.settleErrors} lỗi, chưa chốt bản chụp.`
    );
  } else {
    try {
      const { payload } = await deps.readTrackRecord();
      // Khoá theo ngày dữ liệu, không theo "slot" ngày: số công bố hôm nay là số
      // của lần settlement gần nhất; rỗng thì lấy ngày vừa đóng. Cổng ngày đóng
      // + settlement nằm trong `publishClosedDaySnapshot`.
      const result = await deps.publishClosedDaySnapshot({
        payload,
        day: payload.meta.dataAsOf ?? deps.yesterday(),
        today: deps.today(),
        lastEvaluatedAt: payload.summary.lastEvaluatedAt ?? null,
        hasPicks: (payload.summary.totals?.picks ?? 0) > 0,
        metricsVersion: payload.meta.metricsVersion,
      });
      decision = result.decision;
      if (result.decision.ok && result.result) {
        seal = result.result.created ? "sealed" : "already-sealed";
        console.log(
          `[SNAPSHOT-02] ${seal} day=${result.result.entry.day} head=${result.result.head}`
        );
      } else {
        console.warn(
          `[SNAPSHOT-02] skip day=${result.decision.day} reason=${result.decision.reason} today=${result.decision.today} settlementDay=${result.decision.settlementDay ?? "-"}`
        );
      }
    } catch (snapshotError) {
      seal = "error";
      console.error("Snapshot publish error (non-blocking):", snapshotError);
    }
  }

  let gaps: SnapshotGapReport | null = null;
  let alert: SnapshotGapAlertOutcome | null = null;
  try {
    const today = deps.today();
    gaps = await deps.listSnapshotGaps({ today });
    if (gaps.missing.length > 0) {
      console.warn(
        `[SNAPSHOT-02] ${gaps.missing.length} ngày đã đóng trong ${gaps.windowDays} ngày gần nhất CHƯA có bản chụp (không chốt bù — số hiện tại không phải số của ngày đó): ${gaps.missing.join(", ")}. Đuôi chuỗi neo: ${gaps.tip ?? "chưa có"}.`
      );
      alert = await deps.alertSnapshotGaps(gaps, { today });
      if (alert.reason === "no-channel") {
        console.warn(
          "[SNAPSHOT-02] chưa cấu hình kênh alert nào — cảnh báo gap chỉ nằm trong log."
        );
      } else if (alert.reason === "error") {
        console.warn("[SNAPSHOT-02] gửi cảnh báo gap thất bại — xem log [SNAPSHOT-GAP].");
      }
    }
  } catch (gapError) {
    console.error("Snapshot gap check error (non-blocking):", gapError);
  }

  return { seal, decision, gaps, alert };
}
