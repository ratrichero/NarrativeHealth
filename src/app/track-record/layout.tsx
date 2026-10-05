import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Track Record — Narrative Health",
  description:
    "Verified performance of the daily Narrative Health picks: net R after fees and slippage, win rate with a 95% confidence interval, max drawdown, profit factor and a BTC buy-and-hold benchmark.",
  openGraph: {
    title: "Track Record — Narrative Health",
    description:
      "Every settled pick, measured after costs. Net R, Wilson confidence interval, max drawdown and a BTC benchmark — no cherry-picking.",
    type: "website",
  },
};

export default function TrackRecordLayout({ children }: { children: ReactNode }) {
  return children;
}
