import { describe, expect, it } from "@jest/globals";
import {
  SNAPSHOT_GENESIS_HASH,
  buildSnapshotEntry,
  canonicalJson,
  computeSnapshotHash,
  snapshotPayloadHash,
  verifySnapshotChain,
  type SnapshotEntry,
} from "@/lib/backtest/snapshot";

const payloadA = { b: 2, a: 1, nested: { z: true, y: [1, 2] } };
const payloadB = { totalRNet: 12.5, metricsVersion: "track-record-v9" };

function chain(): SnapshotEntry[] {
  const first = buildSnapshotEntry(
    {
      day: "2026-11-20",
      payloadHash: snapshotPayloadHash(payloadA),
      metricsVersion: "track-record-v9",
      prevHash: SNAPSHOT_GENESIS_HASH,
    },
    { sequence: 1 }
  );
  const second = buildSnapshotEntry(
    {
      day: "2026-11-21",
      payloadHash: snapshotPayloadHash(payloadB),
      metricsVersion: "track-record-v9",
      prevHash: first.hash,
    },
    { sequence: 2 }
  );
  return [first, second];
}

describe("SNAPSHOT-01 — payload canonical + hash", () => {
  it("canonicalJson sắp key đệ quy nên thứ tự dựng object không đổi hash", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(snapshotPayloadHash({ a: 1, b: 2 })).toBe(snapshotPayloadHash({ b: 2, a: 1 }));
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
  });

  it("payload khác một số → hash khác", () => {
    expect(snapshotPayloadHash({ totalRNet: 1 })).not.toBe(
      snapshotPayloadHash({ totalRNet: 2 })
    );
  });

  it("hash dòng phụ thuộc prevHash (đổi quá khứ làm lệch tương lai)", () => {
    const base = {
      day: "2026-11-21",
      payloadHash: snapshotPayloadHash(payloadB),
      metricsVersion: "track-record-v9",
      prevHash: SNAPSHOT_GENESIS_HASH,
    };
    expect(computeSnapshotHash(base)).not.toBe(
      computeSnapshotHash({ ...base, prevHash: "a".repeat(64) })
    );
    expect(computeSnapshotHash(base)).not.toBe(
      computeSnapshotHash({ ...base, metricsVersion: "track-record-v10" })
    );
  });
});

describe("SNAPSHOT-01 — kiểm chuỗi", () => {
  it("chuỗi hợp lệ, kể cả khi kiểm payload gốc", () => {
    const entries = chain();
    expect(verifySnapshotChain(entries)).toEqual({
      ok: true,
      brokenAtIndex: null,
      reason: null,
      checked: 2,
    });
    expect(verifySnapshotChain(entries, [payloadA, payloadB]).ok).toBe(true);
  });

  it("sửa hash một dòng → phát hiện tại đúng dòng đó", () => {
    const entries = chain();
    entries[0] = { ...entries[0], hash: "b".repeat(64) };
    const result = verifySnapshotChain(entries);
    expect(result.ok).toBe(false);
    expect(result.brokenAtIndex).toBe(0);
    expect(result.reason).toBe("hash-mismatch");
  });

  it("dòng sau trỏ sai prevHash → gãy tại dòng đó", () => {
    const entries = chain();
    entries[1] = { ...entries[1], prevHash: "c".repeat(64) };
    const result = verifySnapshotChain(entries);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("prev-hash-mismatch");
    expect(result.brokenAtIndex).toBe(1);
  });

  it("dòng sau trỏ sai hash mà prevHash vẫn khớp → hash-mismatch", () => {
    const entries = chain();
    entries[1] = {
      ...entries[1],
      hash: computeSnapshotHash({
        day: entries[1].day,
        payloadHash: entries[1].payloadHash,
        metricsVersion: entries[1].metricsVersion,
        prevHash: "e".repeat(64),
      }),
    };
    const result = verifySnapshotChain(entries);
    expect(result.reason).toBe("hash-mismatch");
    expect(result.brokenAtIndex).toBe(1);
  });

  it("payload bị sửa dù hash dòng khớp → payload-hash-mismatch", () => {
    const entries = chain();
    const result = verifySnapshotChain(entries, [payloadA, { tampered: true }]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("payload-hash-mismatch");
    expect(result.brokenAtIndex).toBe(1);
  });

  it("nhảy sequence hoặc ngày không tăng → gãy chuỗi", () => {
    const withGap = chain();
    withGap[1] = { ...withGap[1], sequence: 5 };
    expect(verifySnapshotChain(withGap).reason).toBe("sequence-gap");

    const sameDay = chain();
    sameDay[1] = { ...sameDay[1], day: sameDay[0].day };
    expect(verifySnapshotChain(sameDay).reason).toBe("day-not-increasing");
  });

  it("dòng đầu sequence=1 phải nối genesis", () => {
    const [first] = chain();
    expect(
      verifySnapshotChain([{ ...first, prevHash: "d".repeat(64) }]).reason
    ).toBe("prev-hash-mismatch");
  });
});
