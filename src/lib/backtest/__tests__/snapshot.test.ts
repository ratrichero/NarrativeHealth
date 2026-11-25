import { describe, expect, it } from "@jest/globals";
import {
  SNAPSHOT_GENESIS_HASH,
  SNAPSHOT_SCHEMA_VERSION,
  buildSnapshotEntry,
  buildSnapshotPayload,
  closedDaysBefore,
  canonicalJson,
  computeHeadHash,
  sha256Hex,
  snapshotPayloadHash,
  snapshotPayloadMatches,
} from "@/lib/backtest/snapshot";

const payloadA = { b: 2, a: 1, nested: { z: true, y: [1, 2] } };
const payloadB = { totalRNet: 12.5, metricsVersion: "track-record-v11" };

describe("SNAPSHOT-02 — payload canonical + hash", () => {
  it("canonicalJson sắp key đệ quy nên thứ tự dựng object không đổi hash", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(snapshotPayloadHash({ a: 1, b: 2 })).toBe(snapshotPayloadHash({ b: 2, a: 1 }));
    expect(snapshotPayloadHash(payloadA)).toHaveLength(64);
  });

  it("undefined bị bỏ, NaN về null — hash không phụ thuộc môi trường", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe(canonicalJson({ b: 1 }));
    expect(canonicalJson({ a: Number.NaN })).toBe('{"a":null}');
  });

  it("payload khác → hash khác; payload giống → hash giống", () => {
    expect(snapshotPayloadHash(payloadA)).not.toBe(snapshotPayloadHash(payloadB));
    expect(snapshotPayloadHash(payloadA)).toBe(snapshotPayloadHash({ ...payloadA }));
  });

  it("snapshotPayloadMatches chỉ đúng khi payload còn nguyên", () => {
    const entry = buildSnapshotEntry({
      day: "2026-11-20",
      payloadHash: snapshotPayloadHash(payloadA),
      metricsVersion: "track-record-v11",
      prevHead: SNAPSHOT_GENESIS_HASH,
    });
    expect(snapshotPayloadMatches(entry, payloadA)).toBe(true);
    expect(snapshotPayloadMatches(entry, { ...payloadA, b: 3 })).toBe(false);
  });
});

describe("SNAPSHOT-02 — dấu chụp nằm trong payload", () => {
  const capturedAt = "2026-11-24T00:10:00.000Z";

  it("buildSnapshotPayload thêm snapshot.capturedAt và đổi hash so với payload trần", () => {
    const sealed = buildSnapshotPayload(payloadA, { capturedAt });

    expect(sealed.snapshot).toEqual({ capturedAt });
    // Số liệu giữ nguyên — chỉ thêm dấu.
    expect(sealed.a).toBe(payloadA.a);
    expect(snapshotPayloadHash(sealed)).not.toBe(snapshotPayloadHash(payloadA));
  });

  it("cùng số liệu, khác capturedAt → hash khác: không sửa được thời điểm chụp", () => {
    const a = buildSnapshotPayload(payloadB, { capturedAt });
    const b = buildSnapshotPayload(payloadB, { capturedAt: "2026-11-24T00:11:00.000Z" });

    expect(snapshotPayloadHash(a)).not.toBe(snapshotPayloadHash(b));
  });

  it("version hiện tại là v2 và quy tắc băm dùng đúng version đó", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(2);
    expect(snapshotPayloadHash(payloadB)).toBe(
      sha256Hex(`v${SNAPSHOT_SCHEMA_VERSION}|${canonicalJson(payloadB)}`)
    );
  });
});

describe("SNAPSHOT-02 — head neo", () => {
  const base = {
    day: "2026-11-20",
    payloadHash: snapshotPayloadHash(payloadA),
    prevHead: SNAPSHOT_GENESIS_HASH,
  };
  const entryInput = { ...base, metricsVersion: "track-record-v11" };

  it("head = băm (head trước, ngày, payload hash)", () => {
    expect(computeHeadHash(base)).toBe(
      sha256Hex(`head-v1|${base.day}|${base.payloadHash}|${base.prevHead}`)
    );
    expect(computeHeadHash(base)).toHaveLength(64);
    expect(computeHeadHash(base)).not.toBe(base.payloadHash);
  });

  it("đổi ngày, payload hoặc head trước đều đổi head", () => {
    const head = computeHeadHash(base);
    expect(computeHeadHash({ ...base, day: "2026-11-21" })).not.toBe(head);
    expect(
      computeHeadHash({ ...base, payloadHash: snapshotPayloadHash(payloadB) })
    ).not.toBe(head);
    expect(computeHeadHash({ ...base, prevHead: "a".repeat(64) })).not.toBe(head);
  });

  it("chuỗi hai ngày nối bằng head: head hôm sau tính từ head hôm trước", () => {
    const first = buildSnapshotEntry(entryInput);
    const second = buildSnapshotEntry(
      {
        day: "2026-11-21",
        payloadHash: snapshotPayloadHash(payloadB),
        metricsVersion: "track-record-v11",
        prevHead: first.headHash,
      },
      { createdAt: "2026-11-22T00:00:00.000Z" }
    );
    expect(second.headHash).toBe(
      computeHeadHash({
        day: second.day,
        payloadHash: second.payloadHash,
        prevHead: first.headHash,
      })
    );
    // Sao lưu ngoài head của ngày đầu là đủ để phát hiện sửa ngày đầu.
    expect(first.headHash).toBe(computeHeadHash(base));
  });
});

describe("SNAPSHOT-02 — ngày đã đóng gần nhất", () => {
  it("closedDaysBefore trả các ngày đã đóng gần nhất, cũ → mới, không gồm hôm nay", () => {
    expect(closedDaysBefore("2026-11-24", 3)).toEqual(["2026-11-21", "2026-11-22", "2026-11-23"]);
    // Qua ranh giới tháng/năm theo UTC, không phụ thuộc timezone máy chạy.
    expect(closedDaysBefore("2026-01-02", 3)).toEqual(["2025-12-30", "2025-12-31", "2026-01-01"]);
    expect(closedDaysBefore("2026-11-24", 0)).toEqual(["2026-11-23"]);
  });
});
