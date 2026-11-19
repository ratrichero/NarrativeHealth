"""RADAR-06-STALE — quy ước "0 = tắt" của nhịp catalyst.

Next.js (`src/lib/catalyst/health.ts`) bỏ qua STALE khi job bị tắt. Test này khoá
phía FastAPI ở đúng quy ước đó: `schedulerEnabled=false` hoặc nhịp 0 = gỡ job,
không phải "dùng default".

Chạy: python3 -m unittest backend.test_catalyst_schedule
"""
import unittest

from backend.scheduler import resolve_catalyst_schedule


def schedule(**overrides):
    values = {
        "schedulerEnabled": True,
        "schedulerAnnouncementsMinutes": 5,
        "schedulerNewsMinutes": 15,
        "schedulerUnlocksMinutes": 60,
    }
    values.update(overrides)
    return resolve_catalyst_schedule(values)


class ResolveCatalystScheduleTest(unittest.TestCase):
    def test_zero_minutes_disables_only_that_scope(self):
        enabled, intervals = schedule(
            schedulerAnnouncementsMinutes=0,
            schedulerNewsMinutes=15,
            schedulerUnlocksMinutes=60,
        )
        self.assertTrue(enabled)
        self.assertEqual(intervals["announcements"], 0)  # 0 = tắt job này
        self.assertEqual(intervals["news"], 15)
        self.assertEqual(intervals["unlocks"], 60)

    def test_negative_minutes_also_disables(self):
        _, intervals = schedule(schedulerAnnouncementsMinutes=-5)
        self.assertEqual(intervals["announcements"], 0)

    def test_scheduler_disabled_keeps_intervals_but_removes_all_jobs(self):
        enabled, intervals = schedule(schedulerEnabled=False)
        self.assertFalse(enabled)
        self.assertEqual(intervals, {"announcements": 5, "news": 15, "unlocks": 60})

    def test_missing_or_broken_value_falls_back_to_env_default(self):
        _, intervals = schedule(schedulerAnnouncementsMinutes=None)
        self.assertGreater(intervals["announcements"], 0)
        _, intervals = schedule(schedulerNewsMinutes="not-a-number")
        self.assertGreater(intervals["news"], 0)

    def test_interval_is_clamped_to_1440(self):
        _, intervals = schedule(schedulerUnlocksMinutes=99_999)
        self.assertEqual(intervals["unlocks"], 1440)


if __name__ == "__main__":
    unittest.main()
