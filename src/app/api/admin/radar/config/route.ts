import { NextRequest, NextResponse } from "next/server";
import {
  RadarConfigError,
  RADAR_CONFIG_FIELDS,
  RADAR_CONFIG_GROUPS,
  envRadarConfig,
  readRadarRuntimeConfig,
  updateRadarRuntimeConfig,
} from "@/lib/settings/radar-config";
import { invalidateRadarSnapshotCache } from "@/lib/market/radar";

export const dynamic = "force-dynamic";

// RADAR-CONFIG — cấu hình runtime radar/catalyst (admin session do proxy AUTH-01 chặn).
// GET trả config hiệu lực + giá trị env fallback để UI hiển thị nguồn.
// PUT nhận { values: { ... }, unpin: ["field", ...] } và ghi app_settings key
// `radar.config`; cache được cập nhật ngay nên không cần restart server.
// `unpin` xoá field khỏi DB để nó quay lại dùng env fallback.
export async function GET() {
  const snapshot = await readRadarRuntimeConfig();
  return NextResponse.json({
    success: true,
    data: {
      ...snapshot,
      env: envRadarConfig(),
      fields: RADAR_CONFIG_FIELDS,
      groups: RADAR_CONFIG_GROUPS,
    },
  });
}

export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { values?: unknown; unpin?: unknown }
    | null;
  const values = body?.values ?? {};
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return NextResponse.json(
      { success: false, error: "Payload phải có dạng { values: { ... }, unpin: [...] }." },
      { status: 400 }
    );
  }
  const unpin = body?.unpin ?? [];
  if (!Array.isArray(unpin) || !unpin.every((key) => typeof key === "string")) {
    return NextResponse.json(
      { success: false, error: "`unpin` phải là mảng tên tham số." },
      { status: 400 }
    );
  }
  if (Object.keys(values).length === 0 && unpin.length === 0) {
    return NextResponse.json(
      { success: false, error: "Payload phải có ít nhất một field trong `values` hoặc `unpin`." },
      { status: 400 }
    );
  }

  try {
    const snapshot = await updateRadarRuntimeConfig(
      values as Record<string, unknown>,
      "admin",
      unpin
    );
    // Bỏ snapshot/detail đã tính bằng cấu hình cũ để thay đổi có hiệu lực ngay.
    invalidateRadarSnapshotCache();
    return NextResponse.json({ success: true, data: snapshot });
  } catch (error) {
    if (error instanceof RadarConfigError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    console.error("[PUT /api/admin/radar/config]", error);
    return NextResponse.json(
      { success: false, error: "Không lưu được cấu hình radar." },
      { status: 500 }
    );
  }
}
