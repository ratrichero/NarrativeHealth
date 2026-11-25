"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Hỏi `/api/auth/admin` một lần để UI biết người dùng có phải admin.
 *
 * Sau SCHEDULER-AUTH, các nút refresh gọi route ghi (`POST /api/refresh...`)
 * sẽ trả 401 với user thường, nên nút chỉ được hiện khi chắc chắn là admin.
 * Mặc định `false` (ẩn nút) cho tới khi server xác nhận.
 *
 * Dùng react-query với query key chung nên mọi component (mỗi NarrativeCard,
 * RefreshButton, trang coin) chia sẻ cùng một request trong cửa sổ staleTime;
 * dashboard nhiều card không còn gọi `/api/auth/admin` lặp lại.
 */
export const IS_ADMIN_QUERY_KEY = ["auth", "is-admin"] as const;
export const IS_ADMIN_STALE_TIME_MS = 5 * 60 * 1000;

async function fetchIsAdmin(): Promise<boolean> {
  const response = await fetch("/api/auth/admin", { cache: "no-store" });
  if (!response.ok) return false;
  const body = await response.json();
  return body?.data?.admin === true;
}

export function useIsAdmin(): boolean {
  const { data } = useQuery({
    queryKey: IS_ADMIN_QUERY_KEY,
    queryFn: fetchIsAdmin,
    staleTime: IS_ADMIN_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });

  return data === true;
}
