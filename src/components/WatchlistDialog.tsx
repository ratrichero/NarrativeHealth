"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { X, Star } from "lucide-react";

interface WatchlistDialogProps {
  isOpen: boolean;
  onClose: () => void;
  coinId: number;
  coinSymbol: string;
  coinName: string;
  onAdd: (coinId: number, note?: string, priority?: number) => Promise<void>;
}

export function WatchlistDialog({
  isOpen,
  onClose,
  coinId,
  coinSymbol,
  coinName,
  onAdd,
}: WatchlistDialogProps) {
  const [note, setNote] = useState("");
  const [priority, setPriority] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onAdd(coinId, note || undefined, priority);
      setNote("");
      setPriority(0);
      onClose();
    } catch (error) {
      console.error("Failed to add to watchlist:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md bg-slate-900 border border-slate-800">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-yellow-500" />
              Add to Watchlist
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 p-3 bg-slate-800/50 rounded-lg">
            <div className="font-medium text-white">{coinSymbol}</div>
            <div className="text-sm text-slate-400">{coinName}</div>
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Note (optional)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a note about this coin..."
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 resize-none"
                rows={3}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              >
                <option value={0}>Normal</option>
                <option value={1}>High</option>
                <option value={2}>Urgent</option>
              </select>
            </div>
            
            <div className="flex gap-3 pt-2">
              <Button
                variant="secondary"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting}
                loading={isSubmitting}
                className="flex-1"
              >
                Add to Watchlist
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}