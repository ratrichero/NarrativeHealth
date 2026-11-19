import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

import { RadarConfigSection, buildRadarConfigPayload, type RadarConfigField } from "../RadarConfigSection";

const mockFields: RadarConfigField[] = [
  {
    key: "clusterMaxSize",
    env: "RADAR_CLUSTER_MAX_SIZE",
    label: "Cụm tối đa",
    hint: "3–20",
    group: "cluster",
    type: "int",
    min: 3,
    max: 20,
  },
  {
    key: "alertWebhookUrl",
    env: "RADAR_ALERT_WEBHOOK_URL",
    label: "Webhook alert radar",
    hint: "URL http(s)",
    group: "alert",
    type: "url",
  },
];

const mockPayload = {
  config: { clusterMaxSize: 8, alertWebhookUrl: null },
  applied: ["clusterMaxSize"],
  stored: { clusterMaxSize: 12 },
  updatedAt: "2026-11-19T00:00:00.000Z",
  updatedBy: "admin",
  env: { clusterMaxSize: 8, alertWebhookUrl: null },
  fields: mockFields,
  groups: [
    { id: "cluster", label: "Cụm rotation", hint: "" },
    { id: "alert", label: "Alert radar", hint: "" },
  ],
};

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn(async () => undefined) }),
  useQuery: () => ({ data: mockPayload, isLoading: false, error: null }),
}));

describe("RadarConfigSection", () => {
  it("chỉ hiện nút Bỏ ghim cho field đang pin và nói rõ Lưu chỉ ghi field khác env", () => {
    const html = renderToStaticMarkup(<RadarConfigSection />);

    expect(html).toContain("Cụm tối đa");
    expect(html).toContain("Webhook alert radar");
    // Chỉ clusterMaxSize đang nằm trong DB → đúng 1 nút bỏ ghim.
    expect((html.match(/Bỏ ghim/g) ?? []).length).toBe(1);
    expect(html).toContain("Lưu chỉ ghi field khác env");
    // Field đang dùng env không có nút bỏ ghim.
    expect((html.match(/>DB</g) ?? []).length).toBe(1);
    expect((html.match(/>env</g) ?? []).length).toBe(1);
  });
});

describe("buildRadarConfigPayload", () => {
  it("chỉ gửi field khác env", () => {
    const payload = buildRadarConfigPayload(
      mockFields,
      { clusterMaxSize: "12", alertWebhookUrl: "" },
      mockPayload.env,
      mockPayload.stored
    );
    expect(payload.values).toEqual({ clusterMaxSize: 12 });
    expect(payload.unpin).toEqual([]);
  });

  it("field pin nhưng giờ bằng env → unpin thay vì ghi lại giá trị env", () => {
    const payload = buildRadarConfigPayload(
      mockFields,
      { clusterMaxSize: "8", alertWebhookUrl: "" },
      mockPayload.env,
      mockPayload.stored
    );
    expect(payload.values).toEqual({});
    expect(payload.unpin).toEqual(["clusterMaxSize"]);
  });

  // Trước đây field có trong `unpin` bị skip vô điều kiện, nên bấm Bỏ ghim rồi
  // sửa ô làm mất giá trị vừa nhập. Giá trị khác env phải thắng ý định unpin cũ.
  it("Bỏ ghim rồi sửa ô → lưu giá trị mới, không bị mất", () => {
    const payload = buildRadarConfigPayload(
      mockFields,
      { clusterMaxSize: "12", alertWebhookUrl: "" },
      mockPayload.env,
      mockPayload.stored,
      ["clusterMaxSize"]
    );
    expect(payload.values).toEqual({ clusterMaxSize: 12 });
    expect(payload.unpin).toEqual([]);
  });

  it("Bỏ ghim và vẫn giữ giá trị env → field được unpin", () => {
    const payload = buildRadarConfigPayload(
      mockFields,
      { clusterMaxSize: "8", alertWebhookUrl: "" },
      mockPayload.env,
      mockPayload.stored,
      ["clusterMaxSize"]
    );
    expect(payload.values).toEqual({});
    expect(payload.unpin).toEqual(["clusterMaxSize"]);
  });

  it("url được trim và chỉ ghim khi khác env", () => {
    const payload = buildRadarConfigPayload(
      mockFields,
      { clusterMaxSize: "8", alertWebhookUrl: " https://hooks.example/x " },
      mockPayload.env,
      mockPayload.stored
    );
    expect(payload.values).toEqual({ alertWebhookUrl: "https://hooks.example/x" });
    expect(payload.unpin).toEqual(["clusterMaxSize"]);
  });

  it("ô số rỗng bị chặn trước khi gọi API", () => {
    expect(() =>
      buildRadarConfigPayload(
        mockFields,
        { clusterMaxSize: "", alertWebhookUrl: "" },
        mockPayload.env,
        mockPayload.stored
      )
    ).toThrow(/phải là số/);
  });
});
