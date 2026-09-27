/**
 * ALERT-06 — Admin: sync token unlock events from the configured provider
 * (UNLOCK_DATA_URL) into event_risks. Optional; no-op without configuration.
 */

import { NextResponse } from "next/server";
import { syncTokenUnlocks } from "@/lib/collectors/unlocks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    const summary = await syncTokenUnlocks();
    return NextResponse.json({ success: true, data: summary });
  } catch (error) {
    console.error("[POST /api/admin/events/sync-unlocks]", error);
    return NextResponse.json(
      { success: false, error: "Failed to sync token unlocks." },
      { status: 500 }
    );
  }
}
