import {
  buildSchedulerStallMessage,
  evaluateSchedulerHeartbeat,
  isScheduledRefreshJob,
  resolveStallAlertCooldownHours,
  resolveStallHours,
  SCHEDULER_STALL_ALERT_COOLDOWN_VAR,
  SCHEDULER_STALL_HOURS_VAR,
  SCHEDULER_INTERVAL_HOURS_VAR,
  type SchedulerHeartbeatRow,
} from "../heartbeat";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000);

function row(
  jobName: string,
  at: Date | null,
  status = "COMPLETED"
): SchedulerHeartbeatRow {
  return { jobName, status, startedAt: at, completedAt: at };
}

describe("resolveStallHours", () => {
  it("mặc định 26h cho nhịp chạy 1 lần/ngày", () => {
    expect(resolveStallHours({})).toBe(26);
  });

  it("ưu tiên SCHEDULER_STALL_HOURS", () => {
    expect(
      resolveStallHours({
        [SCHEDULER_STALL_HOURS_VAR]: "8",
        [SCHEDULER_INTERVAL_HOURS_VAR]: "2",
      })
    ).toBe(8);
  });

  it("suy ra từ nhịp interval: 1.5 nhịp + 1h, tối thiểu 3h", () => {
    expect(
      resolveStallHours({ [SCHEDULER_INTERVAL_HOURS_VAR]: "2" })
    ).toBe(4);
    expect(
      resolveStallHours({ [SCHEDULER_INTERVAL_HOURS_VAR]: "1" })
    ).toBe(3);
    expect(
      resolveStallHours({ [SCHEDULER_INTERVAL_HOURS_VAR]: "24" })
    ).toBe(37);
  });

  it("kẹp 1–168h", () => {
    expect(resolveStallHours({ [SCHEDULER_STALL_HOURS_VAR]: "0" })).toBe(26);
    expect(resolveStallHours({ [SCHEDULER_STALL_HOURS_VAR]: "999" })).toBe(168);
  });
});

describe("resolveStallAlertCooldownHours", () => {
  it("mặc định 6h, kẹp 1–168", () => {
    expect(resolveStallAlertCooldownHours({})).toBe(6);
    expect(
      resolveStallAlertCooldownHours({
        [SCHEDULER_STALL_ALERT_COOLDOWN_VAR]: "0",
      })
    ).toBe(6);
    expect(
      resolveStallAlertCooldownHours({
        [SCHEDULER_STALL_ALERT_COOLDOWN_VAR]: "12",
      })
    ).toBe(12);
  });
});

describe("isScheduledRefreshJob", () => {
  it("chỉ nhận job do scheduler sinh", () => {
    expect(isScheduledRefreshJob("daily_refresh")).toBe(true);
    expect(isScheduledRefreshJob("interval_refresh")).toBe(true);
    expect(isScheduledRefreshJob("daily_refresh_trigger")).toBe(true);
    expect(isScheduledRefreshJob("interval_refresh_trigger")).toBe(true);
    expect(isScheduledRefreshJob("manual_refresh")).toBe(false);
    expect(isScheduledRefreshJob("refresh_coin_7")).toBe(false);
    expect(isScheduledRefreshJob("p3_execute_daily")).toBe(false);
  });
});

describe("evaluateSchedulerHeartbeat", () => {
  it("khoẻ khi lượt scheduler gần nhất trong ngưỡng", () => {
    const status = evaluateSchedulerHeartbeat([row("interval_refresh_trigger", hoursAgo(2))], NOW, 4);
    expect(status.stalled).toBe(false);
    expect(status.hoursSince).toBe(2);
    expect(status.jobName).toBe("interval_refresh_trigger");
    expect(status.lastSuccessAt).toBe(hoursAgo(2).toISOString());
  });

  it("báo stalled khi lượt gần nhất quá ngưỡng", () => {
    const status = evaluateSchedulerHeartbeat([row("daily_refresh", hoursAgo(30))], NOW, 26);
    expect(status.stalled).toBe(true);
    expect(status.hoursSince).toBe(30);
  });

  it("đúng bằng ngưỡng chưa coi là stalled", () => {
    const status = evaluateSchedulerHeartbeat([row("daily_refresh", hoursAgo(26))], NOW, 26);
    expect(status.stalled).toBe(false);
  });

  it("refresh tay không che việc cron đã chết", () => {
    const status = evaluateSchedulerHeartbeat(
      [row("interval_refresh", hoursAgo(40)), row("manual_refresh", hoursAgo(1))],
      NOW,
      26
    );
    expect(status.stalled).toBe(true);
    expect(status.jobName).toBe("interval_refresh");
    expect(status.hoursSince).toBe(40);
  });

  it("bỏ qua FAILED/STARTED: không có lượt COMPLETED → stalled", () => {
    const status = evaluateSchedulerHeartbeat(
      [row("daily_refresh", hoursAgo(1), "FAILED"), row("daily_refresh", hoursAgo(0.5), "STARTED")],
      NOW,
      26
    );
    expect(status.stalled).toBe(true);
    expect(status.lastSuccessAt).toBeNull();
    expect(status.hoursSince).toBeNull();
  });

  it("bảng rỗng → stalled (VPS chưa từng chạy scheduler)", () => {
    expect(evaluateSchedulerHeartbeat([], NOW, 26).stalled).toBe(true);
  });
});

describe("buildSchedulerStallMessage", () => {
  it("nêu lần cuối, ngưỡng và checklist", () => {
    const status = evaluateSchedulerHeartbeat([row("daily_refresh", hoursAgo(30))], NOW, 26);
    const text = buildSchedulerStallMessage(status, new Date(NOW));
    expect(text).toContain("30 giờ trước");
    expect(text).toContain("Ngưỡng cảnh báo: 26 giờ");
    expect(text).toContain("scheduler_logs");
    expect(text).toContain("PRODUCTION_ALLOWED_HOSTS");
    expect(text).toContain("docs/VPS_ENV_CHECKLIST.md");
  });

  it("bảng rỗng nói rõ chưa có lượt nào", () => {
    const text = buildSchedulerStallMessage(
      evaluateSchedulerHeartbeat([], NOW, 26),
      new Date(NOW)
    );
    expect(text).toContain("chưa có lượt refresh/scheduler nào COMPLETED");
  });
});
