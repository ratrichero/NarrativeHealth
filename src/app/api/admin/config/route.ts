import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scoreConfigs } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

// GET - Get all configs
export async function GET() {
  try {
    const configs = await db
      .select()
      .from(scoreConfigs)
      .where(eq(scoreConfigs.isActive, true))
      .orderBy(scoreConfigs.configType, scoreConfigs.configKey);

    return NextResponse.json({ success: true, data: configs });
  } catch (error) {
    console.error("Error fetching configs:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch configs" },
      { status: 500 }
    );
  }
}

// POST - Create or update config
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { configType, configKey, configValue, description } = body;

    if (!configType || !configKey || configValue === undefined) {
      return NextResponse.json(
        { success: false, error: "configType, configKey, and configValue are required" },
        { status: 400 }
      );
    }

    // Deactivate existing config with same type and key
    await db
      .update(scoreConfigs)
      .set({ isActive: false })
      .where(
        and(
          eq(scoreConfigs.configType, configType),
          eq(scoreConfigs.configKey, configKey),
          eq(scoreConfigs.isActive, true)
        )
      );

    // Get max version for this config
    const [maxVersion] = await db
      .select({ version: scoreConfigs.version })
      .from(scoreConfigs)
      .where(
        and(eq(scoreConfigs.configType, configType), eq(scoreConfigs.configKey, configKey))
      )
      .orderBy(desc(scoreConfigs.version))
      .limit(1);

    const newVersion = (maxVersion?.version || 0) + 1;

    // Create new config version
    const [newConfig] = await db
      .insert(scoreConfigs)
      .values({
        configType,
        configKey,
        configValue,
        version: newVersion,
        isActive: true,
        description: description || null,
      })
      .returning();

    return NextResponse.json({ success: true, data: newConfig }, { status: 201 });
  } catch (error) {
    console.error("Error saving config:", error);
    return NextResponse.json(
      { success: false, error: "Failed to save config" },
      { status: 500 }
    );
  }
}
