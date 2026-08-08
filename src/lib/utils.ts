import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format number with decimals
export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return "-";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Format indicator value with smart decimal places based on magnitude
export function formatIndicatorValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  
  const absValue = Math.abs(value);
  
  if (absValue === 0) return "0";
  
  let decimals = 2;
  if (absValue < 0.0001) decimals = 8;
  else if (absValue < 0.01) decimals = 6;
  else if (absValue < 0.1) decimals = 4;
  else if (absValue < 1) decimals = 4;
  else decimals = 2;
  
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Format percentage
export function formatPercent(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return "-";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${formatNumber(value, decimals)}%`;
}

// Format large numbers (Market Cap, Volume, etc.)
export function formatLargeNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

// Format date
export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Format datetime
export function formatDateTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Get health status from score
export function getHealthStatus(score: number): "STRONG" | "HEALTHY" | "NEUTRAL" | "CAUTION" | "WEAK" {
  if (score >= 90) return "STRONG";
  if (score >= 80) return "HEALTHY";
  if (score >= 65) return "NEUTRAL";
  if (score >= 50) return "CAUTION";
  return "WEAK";
}

// Get recommendation signal from score
export function getSignalFromScore(score: number): "STRONG_WATCH" | "WATCH" | "OBSERVE" | "WEAK" {
  if (score >= 90) return "STRONG_WATCH";
  if (score >= 80) return "WATCH";
  if (score >= 65) return "OBSERVE";
  return "WEAK";
}

// Get color class for health status
export function getHealthColor(status: string): string {
  switch (status) {
    case "STRONG":
    case "HEALTHY":
      return "text-green-500";
    case "NEUTRAL":
    case "CAUTION":
      return "text-yellow-500";
    case "WEAK":
      return "text-red-500";
    default:
      return "text-gray-500";
  }
}

// Get background color class for health status
export function getHealthBgColor(status: string): string {
  switch (status) {
    case "STRONG":
    case "HEALTHY":
      return "bg-green-500/10 border-green-500/20";
    case "NEUTRAL":
    case "CAUTION":
      return "bg-yellow-500/10 border-yellow-500/20";
    case "WEAK":
      return "bg-red-500/10 border-red-500/20";
    default:
      return "bg-gray-500/10 border-gray-500/20";
  }
}

// Get signal color
export function getSignalColor(signal: string): string {
  switch (signal) {
    case "STRONG_WATCH":
      return "text-green-400 bg-green-500/10 border-green-500/20";
    case "WATCH":
      return "text-green-500 bg-green-500/10 border-green-500/20";
    case "OBSERVE":
      return "text-yellow-500 bg-yellow-500/10 border-yellow-500/20";
    case "WEAK":
      return "text-red-500 bg-red-500/10 border-red-500/20";
    default:
      return "text-gray-500 bg-gray-500/10 border-gray-500/20";
  }
}

// Get source status color
export function getSourceStatusColor(status: string): string {
  switch (status) {
    case "OK":
      return "bg-green-500";
    case "PARTIAL":
      return "bg-yellow-500";
    case "FAILED":
      return "bg-red-500";
    default:
      return "bg-gray-500";
  }
}

// Get change arrow
export function getChangeArrow(change: number | null | undefined): string {
  if (change === null || change === undefined) return "→";
  if (change >= 5) return "▲▲";
  if (change >= 1) return "▲";
  if (change <= -5) return "▼▼";
  if (change <= -1) return "▼";
  return "→";
}

// Get change color
export function getChangeColor(change: number | null | undefined): string {
  if (change === null || change === undefined) return "text-gray-500";
  if (change >= 1) return "text-green-500";
  if (change <= -1) return "text-red-500";
  return "text-gray-500";
}

// Get confidence badge style
export function getConfidenceBadgeStyle(confidence: number | null | undefined): string {
  if (confidence === null || confidence === undefined) return "opacity-50";
  if (confidence >= 90) return "";
  if (confidence >= 70) return "opacity-75";
  return "opacity-50";
}

// Sleep utility
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Timezone Configuration
 * Business timezone: Asia/Ho_Chi_Minh (UTC+7)
 * All business dates should use this timezone to ensure consistency
 * with Vietnam market hours and user expectations.
 */
export const BUSINESS_TIMEZONE = "Asia/Ho_Chi_Minh";

/**
 * Get today's business date string in YYYY-MM-DD format in business timezone
 * Returns the date in Asia/Ho_Chi_Minh timezone, not UTC
 */
export function getBusinessDate(date?: Date | string): string {
  const d = date ? (typeof date === "string" ? new Date(date) : date) : new Date();
  
  // Get date in business timezone
  const options: Intl.DateTimeFormatOptions = {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  
  const formatter = new Intl.DateTimeFormat("en-CA", options);
  return formatter.format(d); // Returns YYYY-MM-DD
}

/**
 * Get yesterday's business date string in YYYY-MM-DD format
 */
export function getYesterdayBusinessDate(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return getBusinessDate(yesterday);
}

/**
 * Get current datetime in business timezone for display
 */
export function getBusinessDateTime(date?: Date | string): string {
  const d = date ? (typeof date === "string" ? new Date(date) : date) : new Date();
  
  const options: Intl.DateTimeFormatOptions = {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };
  
  const formatter = new Intl.DateTimeFormat("en-CA", options);
  return formatter.format(d); // Returns YYYY-MM-DD HH:mm:ss
}

/**
 * Get today's date string in YYYY-MM-DD format (UTC) - DEPRECATED
 * Use getBusinessDate() instead for business logic
 * @deprecated Use getBusinessDate() for business date calculations
 */
export function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}
