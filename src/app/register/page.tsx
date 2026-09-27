"use client";

/**
 * ACC-MGMT — Open self-signup page (no email verification by design:
 * đăng ký là dùng được luôn). On success the user is logged in immediately
 * (register issues the session) and returned to ?returnTo.
 */

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/Card";
import { UserPlus, Loader2, AlertCircle } from "lucide-react";

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[70vh] flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
        </div>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo") || "/";

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Mật khẩu nhập lại không khớp.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, displayName: displayName || undefined }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? "Đăng ký thất bại.");
        return;
      }
      router.replace(returnTo.startsWith("/") ? returnTo : "/");
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
              <UserPlus className="h-6 w-6 text-cyan-400" />
            </div>
            <h1 className="text-lg font-bold text-white">Tạo tài khoản</h1>
            <p className="text-xs text-slate-400 mt-1">
              Đăng ký là dùng được ngay — không cần xác thực email
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
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
                placeholder="3-30 ký tự: chữ, số, _"
              />
            </div>

            <div>
              <label htmlFor="displayName" className="block text-sm text-slate-400 mb-1">
                Tên hiển thị <span className="text-slate-600">(tùy chọn)</span>
              </label>
              <input
                id="displayName"
                name="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
                placeholder="Tên của bạn"
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
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
                placeholder="Tối thiểu 8 ký tự"
              />
            </div>

            <div>
              <label htmlFor="confirm" className="block text-sm text-slate-400 mb-1">
                Nhập lại mật khẩu
              </label>
              <input
                id="confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-medium rounded-lg px-4 py-2.5 text-sm transition-colors"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Tạo tài khoản
            </button>

            <p className="text-xs text-slate-400 text-center">
              Đã có tài khoản?{" "}
              <Link
                href={`/login${returnTo !== "/" ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}
                className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
              >
                Đăng nhập
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
