"use client";

import { useState } from "react";
import { Button } from "./ui/Button";
import { RefreshCw } from "lucide-react";

interface RefreshButtonProps {
  onRefreshComplete?: () => void;
}

export function RefreshButton({ onRefreshComplete }: RefreshButtonProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setMessage(null);

    try {
      const response = await fetch("/api/refresh", {
        method: "POST",
      });

      const data = await response.json();

      if (data.success) {
        setMessage(`✓ ${data.data.message} (${data.data.coinsProcessed} coins, ${data.data.duration})`);
        onRefreshComplete?.();
      } else {
        setMessage(`✗ ${data.error || "Refresh failed"}`);
      }
    } catch (error) {
      setMessage("✗ Network error");
    } finally {
      setIsRefreshing(false);
      setTimeout(() => setMessage(null), 5000);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <Button
        onClick={handleRefresh}
        loading={isRefreshing}
        variant="secondary"
        size="sm"
      >
        <RefreshCw className={cn("h-4 w-4 mr-2", isRefreshing && "animate-spin")} />
        {isRefreshing ? "Refreshing..." : "Refresh Data"}
      </Button>
      {message && (
        <span
          className={cn(
            "text-sm",
            message.startsWith("✓") ? "text-green-500" : "text-red-500"
          )}
        >
          {message}
        </span>
      )}
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
