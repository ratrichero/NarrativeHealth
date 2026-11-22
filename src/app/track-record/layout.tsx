import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Track Record — Narrative Health",
  description:
    "Verified performance of the daily Narrative Health picks: net R after fees and slippage, win rate with a 95% confidence interval, max drawdown, profit factor and an equal-weight basket benchmark with BTC as a separate reference.",
  openGraph: {
    title: "Track Record — Narrative Health",
    description:
      "Every settled pick, measured after costs. Net R, Wilson confidence interval, max drawdown and an equal-weight universe basket benchmark (BTC kept as a separate reference) — no cherry-picking.",
    type: "website",
  },
};

export default function TrackRecordLayout({ children }: { children: ReactNode }) {
  return children;
}
