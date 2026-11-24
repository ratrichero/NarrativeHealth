"""SNAPSHOT-02 — job scheduler `snapshot_anchor`.

Khoá đúng ba việc mà job phải làm ngoài việc "gọi được endpoint":
1. gửi `X-Scheduler-Token` bằng token chung `scheduler_catalyst_token`;
2. log `head` trả về (đây là neo in ra ngoài của bảng append-only);
3. 409 (`day-open` / `settlement-pending`) chỉ log lỗi, không làm sập scheduler.

Chạy: python3 -m unittest backend.test_snapshot_anchor
"""
import json
import unittest
from unittest import mock

from backend.scheduler import DataRefreshScheduler


class _FakeResponse:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, response: _FakeResponse):
        self.response = response
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False

    async def post(self, url, json=None, headers=None, timeout=None):
        self.calls.append(
            {"url": url, "json": json, "headers": headers or {}, "timeout": timeout}
        )
        return self.response


@mock.patch("backend.scheduler.settings.scheduler_snapshot_timeout", 60)
@mock.patch("backend.scheduler.settings.scheduler_catalyst_token", "secret-token")
@mock.patch("backend.scheduler.httpx.AsyncClient")
class SnapshotAnchorJobTest(unittest.IsolatedAsyncioTestCase):
    async def _invoke(self, async_client_cls, response: _FakeResponse):
        client = _FakeClient(response)
        async_client_cls.return_value = client
        await DataRefreshScheduler()._run_snapshot_anchor()
        return client

    async def test_posts_snapshot_with_token_header_and_logs_head(
        self, async_client_cls
    ):
        payload = {
            "success": True,
            "data": {
                "created": False,
                "entry": {"day": "2026-11-23", "payloadHash": "p" * 64},
                "head": "h" * 64,
            },
        }
        with self.assertLogs("backend.scheduler", level="INFO") as logs:
            client = await self._invoke(async_client_cls, _FakeResponse(200, payload))

        self.assertEqual(len(client.calls), 1)
        call = client.calls[0]
        self.assertTrue(call["url"].endswith("/api/track-record/snapshots"))
        self.assertEqual(call["headers"].get("X-Scheduler-Token"), "secret-token")
        joined = "\n".join(logs.output)
        self.assertIn("[SNAPSHOT-02]", joined)
        self.assertIn("h" * 64, joined)

    async def test_refusal_409_is_logged_not_raised(self, async_client_cls):
        payload = {
            "success": False,
            "error": "Settlement chưa chạy",
            "data": {"reason": "settlement-pending", "day": "2026-11-23"},
        }
        with self.assertLogs("backend.scheduler", level="ERROR") as logs:
            client = await self._invoke(async_client_cls, _FakeResponse(409, payload))

        self.assertIn("settlement-pending", "\n".join(logs.output))
        self.assertEqual(
            client.calls[0]["headers"].get("X-Scheduler-Token"), "secret-token"
        )

    async def test_missing_token_still_calls_but_warns(self, async_client_cls):
        payload = {"success": False, "error": "token", "data": {}}
        # Patch trong thân test: decorator của class đã set token, lớp patch này
        # phải là lớp cuối cùng trước khi job chạy.
        with mock.patch(
            "backend.scheduler.settings.scheduler_catalyst_token", ""
        ), self.assertLogs("backend.scheduler", level="WARNING") as logs:
            client = await self._invoke(async_client_cls, _FakeResponse(503, payload))

        # Không gửi header rỗng; cảnh báo để người vận hành biết phải set env.
        self.assertNotIn("X-Scheduler-Token", client.calls[0]["headers"])
        self.assertIn("SCHEDULER_CATALYST_TOKEN", "\n".join(logs.output))


if __name__ == "__main__":
    unittest.main()
