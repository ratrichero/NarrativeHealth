import React from "react";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NarrativeCard } from "@/components/NarrativeCard";
import { IS_ADMIN_QUERY_KEY } from "@/lib/hooks/use-is-admin";
import type { NarrativeSummary } from "@/types";

// RADAR/SCHEDULER-AUTH: POST /api/refresh/narrative/:id chỉ cho admin, nên nút
// refresh trong card phải ẩn với user thường. Test này render thật component
// (quyết định hiện/ẩn đi qua useIsAdmin + cache react-query), không chỉ typecheck.

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
  }: {
    href: string | { pathname?: string };
    children: React.ReactNode;
  }) => <a href={typeof href === "string" ? href : "#"}>{children}</a>,
}));

const originalFetch = global.fetch;

function mockFetch() {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({ success: false, error: "not available in test" }),
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function narrative(overrides: Partial<NarrativeSummary> = {}): NarrativeSummary {
  return {
    id: 7,
    name: "AI Agents",
    healthScore: 72,
    previousScore: 68,
    scoreChange: 4,
    status: "HEALTHY",
    coinCount: 12,
    topCoin: { id: 101, symbol: "FET", name: "Fetch.ai", healthScore: 80 },
    weakestCoin: null,
    avgConfidence: 0.7,
    signal: null,
    ...overrides,
  };
}

function renderCard(isAdmin: boolean | undefined): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (isAdmin !== undefined) {
    queryClient.setQueryData(IS_ADMIN_QUERY_KEY, isAdmin);
  }
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <NarrativeCard narrative={narrative()} />
    </QueryClientProvider>
  );
}

describe("NarrativeCard admin-only refresh button", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("ẩn nút refresh khi chưa biết/chưa phải admin", () => {
    mockFetch();
    const html = renderCard(undefined);

    expect(html).toContain("AI Agents");
    expect(html).not.toContain("Refresh data for this narrative");
  });

  it("ẩn nút refresh khi server trả admin = false", () => {
    mockFetch();
    const html = renderCard(false);

    expect(html).not.toContain("Refresh data for this narrative");
  });

  it("hiện nút refresh khi useIsAdmin trả true (cùng cache dùng chung)", () => {
    mockFetch();
    const html = renderCard(true);

    expect(html).toContain("Refresh data for this narrative");
  });
});
