import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { watchlists } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

// DELETE - Remove from watchlist
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const watchlistId = parseInt(id);

    if (isNaN(watchlistId)) {
      return NextResponse.json(
        { success: false, error: "Invalid watchlist ID" },
        { status: 400 }
      );
    }

    const [deleted] = await db
      .delete(watchlists)
      .where(eq(watchlists.id, watchlistId))
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Watchlist item not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error) {
    console.error("Error removing from watchlist:", error);
    return NextResponse.json(
      { success: false, error: "Failed to remove from watchlist" },
      { status: 500 }
    );
  }
}

// PUT - Update watchlist item
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const watchlistId = parseInt(id);
    const body = await request.json();

    if (isNaN(watchlistId)) {
      return NextResponse.json(
        { success: false, error: "Invalid watchlist ID" },
        { status: 400 }
      );
    }

    const { note, priority } = body;

    const updateData: Partial<{ note: string | null; priority: number }> = {};
    if (note !== undefined) updateData.note = note;
    if (priority !== undefined) updateData.priority = priority;

    const [updated] = await db
      .update(watchlists)
      .set(updateData)
      .where(eq(watchlists.id, watchlistId))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Watchlist item not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error updating watchlist:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update watchlist" },
      { status: 500 }
    );
  }
}
