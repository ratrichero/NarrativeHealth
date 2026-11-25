// SNAPSHOT-02-GAP — cảnh báo ngày đã đóng không có bản chụp.
//
// Sau khi bỏ chốt bù, cảnh báo là thứ DUY NHẤT nói ra ngày thiếu ngoài log, nên
// test khoá: tin nhắn phải có ngày + đuôi chuỗi; refresh chạy nhiều lượt trong
// ngày không được dội kênh; hỏng kênh không được ném ra ngoài.

import { describe, expect, it, jest } from "@jest/globals";
import {
  SNAPSHOT_GAP_ALERT_MAX_LISTED,
  alertSnapshotGaps,
  buildSnapshotGapAlertText,
  type SnapshotGapAlertState,
} from "../snapshot-gap-alert";
import type { SnapshotGapReport } from "../snapshot-store";

const TODAY = "2026-11-24";

function report(overrides: Partial<SnapshotGapReport> = {}): SnapshotGapReport {
  return {
    missing: ["2026-11-19", "2026-11-20"],
    windowDays: 31,
    tip: "2026-11-18",
    ...overrides,
  };
}

/** Deps giả: ghi lại lần gửi và state. */
function deps(state: SnapshotGapAlertState | null = null, channels = 1) {
  // Khai báo kiểu đầy đủ để `toHaveBeenCalledWith` kiểm được tham số.
  const dispatch = jest.fn<(label: string, text: string) => Promise<number>>(
    async () => channels
  );
  const writeState = jest.fn<(state: SnapshotGapAlertState) => Promise<void>>(
    async () => undefined
  );
  const readState = jest.fn<() => Promise<SnapshotGapAlertState | null>>(async () => state);
  return { dispatch, writeState, readState };
}

describe("buildSnapshotGapAlertText", () => {
  it("nêu số ngày, đuôi chuỗi và từng ngày thiếu", () => {
    const text = buildSnapshotGapAlertText(report());

    expect(text).toContain("thiếu bản chụp — 2 ngày");
    expect(text).toContain("Đuôi chuỗi neo: 2026-11-18");
    expect(text).toContain("cửa sổ kiểm: 31 ngày");
    expect(text).toContain("• 2026-11-19");
    expect(text).toContain("• 2026-11-20");
    // Nói rõ không chốt bù, để người nhận không đi tìm một tính năng không có.
    expect(text).toContain("Không có chốt bù");
  });

  it("bảng rỗng (chưa neo) → ghi 'chưa có' thay vì bịa ngày", () => {
    const text = buildSnapshotGapAlertText(report({ tip: null, missing: [] }));
    expect(text).toContain("Đuôi chuỗi neo: chưa có");
  });

  it("rất nhiều ngày → chỉ liệt kê tối đa, phần còn lại ghi '… và N ngày'", () => {
    const missing = Array.from({ length: SNAPSHOT_GAP_ALERT_MAX_LISTED + 3 }, (_, i) =>
      `2026-11-${String(i + 1).padStart(2, "0")}`
    );
    const text = buildSnapshotGapAlertText(report({ missing }));

    expect(text.split("• ").length - 1).toBe(SNAPSHOT_GAP_ALERT_MAX_LISTED);
    expect(text).toContain("… và 3 ngày nữa");
    expect(text).toContain(`${SNAPSHOT_GAP_ALERT_MAX_LISTED}/${missing.length}`);
  });
});

describe("alertSnapshotGaps", () => {
  it("không có gap → không gửi, không đọc/ghi state", async () => {
    const { dispatch, writeState, readState } = deps();

    const outcome = await alertSnapshotGaps(report({ missing: [] }), {
      today: TODAY,
      dispatch,
      writeState,
      readState,
    });

    expect(outcome).toEqual({ sent: false, reason: "no-gap" });
    expect(dispatch).not.toHaveBeenCalled();
    expect(writeState).not.toHaveBeenCalled();
  });

  it("có gap, chưa gửi → gửi một lần và lưu state", async () => {
    const { dispatch, writeState, readState } = deps(null, 2);

    const outcome = await alertSnapshotGaps(report(), {
      today: TODAY,
      dispatch,
      writeState,
      readState,
    });

    expect(outcome).toEqual({ sent: true, reason: "ok", channels: 2 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const [label, text] = dispatch.mock.calls[0];
    expect(label).toContain(TODAY);
    expect(text).toContain("2026-11-19");
    expect(writeState).toHaveBeenCalledWith({
      signature: "2026-11-19,2026-11-20",
      day: TODAY,
    });
  });

  it("cùng tập ngày + cùng ngày nghiệp vụ → không dội lại kênh", async () => {
    const { dispatch, writeState, readState } = deps({
      signature: "2026-11-19,2026-11-20",
      day: TODAY,
    });

    const outcome = await alertSnapshotGaps(report(), {
      today: TODAY,
      dispatch,
      writeState,
      readState,
    });

    expect(outcome).toEqual({ sent: false, reason: "already-sent" });
    expect(dispatch).not.toHaveBeenCalled();
    expect(writeState).not.toHaveBeenCalled();
  });

  it("sang ngày mới (cùng tập ngày) → gửi lại", async () => {
    const { dispatch, writeState, readState } = deps({
      signature: "2026-11-19,2026-11-20",
      day: "2026-11-23",
    });

    const outcome = await alertSnapshotGaps(report(), {
      today: TODAY,
      dispatch,
      writeState,
      readState,
    });

    expect(outcome.sent).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("tập ngày đổi (thiếu thêm ngày) → gửi lại", async () => {
    const { dispatch, writeState, readState } = deps({
      signature: "2026-11-19",
      day: TODAY,
    });

    const outcome = await alertSnapshotGaps(report(), {
      today: TODAY,
      dispatch,
      writeState,
      readState,
    });

    expect(outcome.sent).toBe(true);
    expect(writeState).toHaveBeenCalledWith({
      signature: "2026-11-19,2026-11-20",
      day: TODAY,
    });
  });

  it("chưa cấu hình kênh nào → no-channel, không đánh dấu đã gửi", async () => {
    const { dispatch, writeState, readState } = deps(null, 0);

    const outcome = await alertSnapshotGaps(report(), {
      today: TODAY,
      dispatch,
      writeState,
      readState,
    });

    expect(outcome).toEqual({ sent: false, reason: "no-channel" });
    // Lần sau cấu hình kênh thì phải gửi được ngay.
    expect(writeState).not.toHaveBeenCalled();
  });

  it("dispatch ném lỗi → không ném ra ngoài, trả reason=error", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const dispatch = jest.fn(async () => {
      throw new Error("telegram down");
    });

    const outcome = await alertSnapshotGaps(report(), {
      today: TODAY,
      dispatch,
      writeState: jest.fn(async () => undefined),
      readState: jest.fn(async () => null),
    });

    expect(outcome).toEqual({ sent: false, reason: "error" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("đọc state lỗi cũng không ném ra ngoài", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const outcome = await alertSnapshotGaps(report(), {
      today: TODAY,
      dispatch: jest.fn(async () => 1),
      writeState: jest.fn(async () => undefined),
      readState: jest.fn(async () => {
        throw new Error("db down");
      }),
    });

    expect(outcome.reason).toBe("error");
    warn.mockRestore();
  });
});
