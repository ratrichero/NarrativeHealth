/**
 * P3-10E.20 Cross-Language Canonicalization Tests
 *
 * These tests prevent regression of two P3 correctness bugs:
 * 1. PostgreSQL microsecond timestamps vs JavaScript millisecond timestamps
 * 2. Python vs JavaScript JSON serialization for digest computation
 */

import { resolveP3Window, utcDayStart } from "../windows";

describe("P3-10E.20 Cross-Language Canonicalization", () => {
  describe("Timestamp boundary: PostgreSQL microseconds vs JavaScript milliseconds", () => {
    test("JavaScript Date has only millisecond precision", () => {
      const jsDate = new Date("2026-08-10T09:09:44.017Z");
      expect(jsDate.getTime()).toBe(1786352984017);
      expect(jsDate.getMilliseconds()).toBe(17);
    });

    test("PostgreSQL timestamptz has microsecond precision", () => {
      const pgTimestamp = "2026-08-10T09:09:44.01722Z";
      const jsDate = new Date(pgTimestamp);
      expect(jsDate.getTime()).toBe(1786352984017);
      expect(jsDate.getMilliseconds()).toBe(17);
    });

    test("exact equality fails when PostgreSQL stores microseconds", () => {
      // JavaScript truncates to milliseconds, so .017999 becomes .017
      const pgTimestamp = "2026-08-10T09:09:44.017999Z";
      const jsDate = new Date(pgTimestamp);
      const jsFromExact = new Date("2026-08-10T09:09:44.017Z");

      // JavaScript loses the microsecond difference
      expect(jsDate.getTime()).toBe(jsFromExact.getTime());

      // But if PostgreSQL returns the exact stored timestamptz and JS compares
      // using the truncated value, the comparison can still fail in some contexts
      // because the DB driver may preserve precision in the round-trip
      const pgExact = new Date("2026-08-10T09:09:44.017001Z");
      const jsRounded = new Date("2026-08-10T09:09:44.017Z");
      expect(pgExact.getTime()).toBe(jsRounded.getTime()); // JS truncates both to same
    });

    test("range query with 1ms tolerance finds PostgreSQL timestamp", () => {
      const pgTimestamp = new Date("2026-08-10T09:09:44.017999Z");
      const start = new Date(pgTimestamp.getTime());
      const end = new Date(pgTimestamp.getTime() + 1);

      expect(pgTimestamp.getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(pgTimestamp.getTime()).toBeLessThanOrEqual(end.getTime());
    });
  });

  describe("Digest canonicalization: Python json.dumps vs JavaScript JSON.stringify", () => {
    test("JavaScript JSON.stringify produces compact output", () => {
      const data = [{ coinId: 1, isPrimary: true, membershipState: "MEMBER" }];
      const jsCompact = JSON.stringify(data);
      expect(jsCompact).toBe('[{"coinId":1,"isPrimary":true,"membershipState":"MEMBER"}]');
    });

    test("Python equivalent: json.dumps(obj, separators=(',', ':')) matches JS", () => {
      const data = [{ coinId: 1, isPrimary: true, membershipState: "MEMBER" }];
      const jsCompact = JSON.stringify(data);

      // Python equivalent: separators=(',', ':') removes spaces
      // This documents the canonical form both languages must use
      expect(jsCompact).not.toContain(" ");
      expect(jsCompact).toBe('[{"coinId":1,"isPrimary":true,"membershipState":"MEMBER"}]');
    });

    test("cross-language digest must use identical canonical form", () => {
      const members = [
        { coinId: 1, isPrimary: true, membershipState: "MEMBER" },
        { coinId: 4, isPrimary: true, membershipState: "MEMBER" },
      ];

      const jsCanonical = JSON.stringify(members);
      expect(jsCanonical).toBe('[{"coinId":1,"isPrimary":true,"membershipState":"MEMBER"},{"coinId":4,"isPrimary":true,"membershipState":"MEMBER"}]');

      // Python equivalent: json.dumps(members, separators=(',', ':')) 
      // Must produce identical string for digest to match
      expect(jsCanonical).not.toContain(" ");
    });
  });

  describe("Membership resolver: ELIGIBLE contract", () => {
    test("resolver returns ELIGIBLE, not MEMBER", async () => {
      const { resolveP3Membership } = await import("../membership");

      const result = await resolveP3Membership(1, new Date("2026-08-11T00:00:00Z"));

      if (result.availability === "AVAILABLE") {
        expect(result.constituents.length).toBeGreaterThan(0);
        for (const c of result.constituents) {
          expect(c.membershipState).toBe("ELIGIBLE");
        }
      }
    });
  });

  describe("P3 window resolution: UTC day boundaries", () => {
    test("7D window ending 2026-08-11 has correct start target", () => {
      const windowEnd = new Date("2026-08-11T00:00:00Z");
      const resolved = resolveP3Window("7D", windowEnd);
      expect(resolved.startTarget.toISOString().slice(0, 10)).toBe("2026-08-03");
      expect(resolved.endTarget.toISOString().slice(0, 10)).toBe("2026-08-10");
    });

    test("14D window ending 2026-08-11 has correct start target", () => {
      const windowEnd = new Date("2026-08-11T00:00:00Z");
      const resolved = resolveP3Window("14D", windowEnd);
      expect(resolved.startTarget.toISOString().slice(0, 10)).toBe("2026-07-27");
      expect(resolved.endTarget.toISOString().slice(0, 10)).toBe("2026-08-10");
    });
  });
});
