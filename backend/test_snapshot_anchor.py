"""SNAPSHOT-02 — job scheduler `snapshot_anchor`.

Khoá những việc mà job phải làm ngoài việc "gọi được endpoint":
1. gửi `X-Scheduler-Token` bằng token chung `scheduler_catalyst_token`;
2. log `head` trả về (đây là neo in ra ngoài của bảng append-only);
3. 409 không làm sập scheduler;
4. **chờ refresh**: lượt 07:10 gặp 409 `settlement-pending` khi refresh 07:00
   còn chạy → chờ `retry_minutes` rồi thử lại, tối đa `attempts` lượt, thay vì
   bỏ mất ngày; `day-open` và lỗi cấu hình (401/403/503) thì dừng ngay.

Chạy: python3 -m unittest backend.test_snapshot_anchor
"""
import json
import unittest
from unittest import mock
from unittest.mock import AsyncMock

from httpx import ConnectError

from backend.scheduler import DataRefreshScheduler, snapshot_anchor_retry_decision


class _FakeResponse:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


class _FakeClient:
    """Trả lần lượt các response đã chuẩn bị; phần tử cuối lặp lại.

    Một phần tử có thể là Exception để mô phỏng lỗi kết nối.
    """

    def __init__(self, responses):
        self._responses = list(responses) if isinstance(responses, list) else [responses]
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False

    async def post(self, url, json=None, headers=None, timeout=None):
        self.calls.append(
            {"url": url, "json": json, "headers": headers or {}, "timeout": timeout}
        )
        item = self._responses.pop(0) if len(self._responses) > 1 else self._responses[0]
        if isinstance(item, Exception):
            raise item
        return item


def success_payload(head="h" * 64, day="2026-11-23") -> dict:
    return {
        "success": True,
        "data": {
            "created": False,
            "entry": {"day": day, "payloadHash": "p" * 64},
            "head": head,
        },
    }


def pending_payload(reason="settlement-pending") -> dict:
    return {
        "success": False,
        "error": "Settlement chưa chạy",
        "data": {"reason": reason, "day": "2026-11-23"},
    }


class RetryDecisionTest(unittest.TestCase):
    """Luật chờ là pure function — test thẳng, không cần mạng."""

    def test_success_is_done(self):
        self.assertEqual(snapshot_anchor_retry_decision(200, None, 5), "done")

    def test_settlement_pending_waits_while_attempts_left(self):
        self.assertEqual(
            snapshot_anchor_retry_decision(409, "settlement-pending", 5), "retry"
        )
        # reason không đọc được (refresh trả lỗi dở) vẫn đáng chờ.
        self.assertEqual(snapshot_anchor_retry_decision(409, None, 1), "retry")

    def test_settlement_pending_fails_when_out_of_attempts(self):
        self.assertEqual(
            snapshot_anchor_retry_decision(409, "settlement-pending", 0), "fail"
        )

    def test_day_open_is_terminal(self):
        # Ngày chưa đóng thì chờ mấy cũng vậy — dừng, để log nói ra.
        self.assertEqual(snapshot_anchor_retry_decision(409, "day-open", 5), "fail")

    def test_config_and_auth_errors_are_terminal(self):
        for status in (401, 403, 503):
            self.assertEqual(snapshot_anchor_retry_decision(status, None, 5), "fail")

    def test_transient_errors_are_retried(self):
        for status in (0, 429, 500, 502, 504):
            self.assertEqual(snapshot_anchor_retry_decision(status, None, 5), "retry")
        # Hết lượt thì mọi lỗi thoáng qua đều thành fail.
        self.assertEqual(snapshot_anchor_retry_decision(500, None, 0), "fail")


@mock.patch("backend.scheduler.settings.scheduler_snapshot_timeout", 60)
@mock.patch("backend.scheduler.settings.scheduler_snapshot_attempts", 3)
@mock.patch("backend.scheduler.settings.scheduler_snapshot_retry_minutes", 15)
@mock.patch("backend.scheduler.settings.scheduler_catalyst_token", "secret-token")
@mock.patch("backend.scheduler.httpx.AsyncClient")
class SnapshotAnchorJobTest(unittest.IsolatedAsyncioTestCase):
    async def _invoke(self, async_client_cls, responses):
        client = _FakeClient(responses)
        async_client_cls.return_value = client
        with mock.patch(
            "backend.scheduler.asyncio.sleep", new=AsyncMock()
        ) as sleep:
            await DataRefreshScheduler()._run_snapshot_anchor()
        return client, sleep

    async def test_posts_snapshot_with_token_header_and_logs_head(
        self, async_client_cls
    ):
        with self.assertLogs("backend.scheduler", level="INFO") as logs:
            client, sleep = await self._invoke(
                async_client_cls, _FakeResponse(200, success_payload())
            )

        self.assertEqual(len(client.calls), 1)
        call = client.calls[0]
        self.assertTrue(call["url"].endswith("/api/track-record/snapshots"))
        self.assertEqual(call["headers"].get("X-Scheduler-Token"), "secret-token")
        joined = "\n".join(logs.output)
        self.assertIn("[SNAPSHOT-02]", joined)
        self.assertIn("h" * 64, joined)
        # Thành công lượt đầu thì không chờ ai.
        sleep.assert_not_awaited()

    async def test_retries_after_settlement_pending_until_success(
        self, async_client_cls
    ):
        # 07:10 gặp refresh còn chạy, 07:25 settlement đã xong.
        with self.assertLogs("backend.scheduler", level="INFO") as logs:
            client, sleep = await self._invoke(
                async_client_cls,
                [
                    _FakeResponse(409, pending_payload("settlement-pending")),
                    _FakeResponse(200, success_payload(head="s" * 64)),
                ],
            )

        self.assertEqual(len(client.calls), 2)
        sleep.assert_awaited_once_with(15 * 60)
        joined = "\n".join(logs.output)
        # Cả lần chờ (WARNING) lẫn lần neo thành công (INFO) đều phải có trong log.
        self.assertIn("chưa chốt được (lần 1/3)", joined)
        self.assertIn("settlement-pending", joined)
        self.assertIn("s" * 64, joined)

    async def test_gives_up_after_max_attempts_on_persistent_pending(
        self, async_client_cls
    ):
        with self.assertLogs("backend.scheduler", level="ERROR") as logs:
            client, sleep = await self._invoke(
                async_client_cls, _FakeResponse(409, pending_payload())
            )

        # 3 lượt theo settings, chờ giữa các lượt: 2 lần.
        self.assertEqual(len(client.calls), 3)
        self.assertEqual(sleep.await_count, 2)
        joined = "\n".join(logs.output)
        self.assertIn("Snapshot anchor failed (lần 3/3)", joined)
        self.assertIn("settlement-pending", joined)

    async def test_day_open_does_not_wait(self, async_client_cls):
        with self.assertLogs("backend.scheduler", level="ERROR") as logs:
            client, sleep = await self._invoke(
                async_client_cls, _FakeResponse(409, pending_payload("day-open"))
            )

        self.assertEqual(len(client.calls), 1)
        sleep.assert_not_awaited()
        self.assertIn("day-open", "\n".join(logs.output))

    async def test_missing_token_config_error_is_not_retried(
        self, async_client_cls
    ):
        with self.assertLogs("backend.scheduler", level="ERROR") as logs:
            client, sleep = await self._invoke(
                async_client_cls, _FakeResponse(503, {"success": False, "data": {}})
            )

        self.assertEqual(len(client.calls), 1)
        sleep.assert_not_awaited()
        self.assertIn("503", "\n".join(logs.output))

    async def test_connection_error_is_retried_then_succeeds(self, async_client_cls):
        # Next restart giữa lúc refresh: lỗi kết nối không phải lý do bỏ ngày.
        with self.assertLogs("backend.scheduler", level="INFO") as logs:
            client, sleep = await self._invoke(
                async_client_cls,
                [
                    ConnectError("connect refused"),
                    _FakeResponse(200, success_payload()),
                ],
            )

        self.assertEqual(len(client.calls), 2)
        sleep.assert_awaited_once_with(15 * 60)
        joined = "\n".join(logs.output)
        self.assertIn("Snapshot API connection failed", joined)
        self.assertIn("h" * 64, joined)

    async def test_missing_token_still_calls_but_warns(self, async_client_cls):
        payload = {"success": False, "error": "token", "data": {}}
        # Patch trong thân test: decorator của class đã set token, lớp patch này
        # phải là lớp cuối cùng trước khi job chạy.
        with mock.patch(
            "backend.scheduler.settings.scheduler_catalyst_token", ""
        ), mock.patch(
            "backend.scheduler.asyncio.sleep", new=AsyncMock()
        ), self.assertLogs("backend.scheduler", level="WARNING") as logs:
            client = _FakeClient(_FakeResponse(503, payload))
            async_client_cls.return_value = client
            await DataRefreshScheduler()._run_snapshot_anchor()

        # Không gửi header rỗng; cảnh báo để người vận hành biết phải set env.
        self.assertNotIn("X-Scheduler-Token", client.calls[0]["headers"])
        self.assertIn("SCHEDULER_CATALYST_TOKEN", "\n".join(logs.output))


if __name__ == "__main__":
    unittest.main()
