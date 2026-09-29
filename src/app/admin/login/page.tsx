"use client";

/**
 * AUTH-01 — Admin login. When no admin exists yet, the form becomes
 * "bootstrap" mode: the first submitted credentials CREATE the admin.
 * After login the user is sent to ?returnTo or /admin.
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/Card";
import { ShieldCheck, Loader2, AlertCircle, KeyRound } from "lucide-react";

export default function AdminLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[70vh] flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
        </div>
      }
    >
      <AdminLoginForm />
    </Suspense>
  );
}

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo") || "/admin";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootstrap, setBootstrap] = useState<boolean | null>(null);

  // Is this the very first admin? (bootstrap mode)
  // AUTH-FIX: this probe must NEVER keep the submit button disabled — on a
  // slow server the status endpoint can hang (DB wait) and the button looked
  // permanently grey. Timeout to 2.5s; on any failure assume NOT bootstrap
  // and enable the button — the login route itself decides authoritatively
  // (creates the first admin or returns invalid-credentials).
  useEffect(() => {
    fetch("/api/auth/status", { signal: AbortSignal.timeout(2500) })
      .then((r) => r.json())
      .then((json) => {
        if (json.success && typeof json.data?.adminCount === "number") {
          setBootstrap(json.data.adminCount === 0);
        } else {
          setBootstrap(false);
        }
      })
      .catch(() => setBootstrap(false));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? "Đăng nhập thất bại.");
        return;
      }
      router.replace(returnTo.startsWith("/") ? returnTo : "/admin");
      router.refresh();
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <Card className="w-full max-w-sm border-slate-800">
        <CardContent className="p-6 sm:p-8">
          <div className="flex flex-col items-center text-center mb-6">
            <div className="h-12 w-12 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mb-3">
              <ShieldCheck className="h-6 w-6 text-cyan-400" />
            </div>
            <h1 className="text-lg font-bold text-white">Admin Control Panel</h1>
            <p className="text-xs text-slate-400 mt-1">
              {bootstrap === true
                ? "Tài khoản quản trị đầu tiên — sẽ được tạo khi gửi form"
                : "Đăng nhập để cấu hình hệ thống"}
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2 text-sm text-red-300">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                {error}
              </div>
            )}

            <div>
              <label htmlFor="username" className="block text-sm text-slate-400 mb-1">
                Tên đăng nhập
              </label>
              <input
                id="username"
                name="username"
                autoComplete="username"
                required
                minLength={3}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
                placeholder="admin"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm text-slate-400 mb-1">
                Mật khẩu
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={bootstrap ? "new-password" : "current-password"}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
                placeholder="••••••••"
              />
              {bootstrap === true && (
                <p className="text-[11px] text-slate-500 mt-1.5">
                  Tối thiểu 8 ký tự. Hãy chọn mật khẩu mạnh.
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || bootstrap === null}
              className="w-full inline-flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-medium rounded-lg px-4 py-2.5 text-sm transition-colors"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              {bootstrap === true ? "Tạo tài khoản & đăng nhập" : "Đăng nhập"}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
