import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

// POST - Update scheduler config
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { enabled, hour, minute, intervalHours } = body;

    // Read current .env file
    const envPath = join(process.cwd(), ".env");
    let envContent = readFileSync(envPath, "utf-8");

    // Update scheduler settings
    if (enabled !== undefined) {
      envContent = envContent.replace(
        /SCHEDULER_ENABLED=.*/,
        `SCHEDULER_ENABLED=${enabled}`
      );
    }
    if (hour !== undefined) {
      envContent = envContent.replace(
        /SCHEDULER_HOUR=.*/,
        `SCHEDULER_HOUR=${hour}`
      );
    }
    if (minute !== undefined) {
      envContent = envContent.replace(
        /SCHEDULER_MINUTE=.*/,
        `SCHEDULER_MINUTE=${minute}`
      );
    }
    if (intervalHours !== undefined) {
      // Check if SCHEDULER_INTERVAL_HOURS exists, if not add it
      if (envContent.includes("SCHEDULER_INTERVAL_HOURS")) {
        envContent = envContent.replace(
          /SCHEDULER_INTERVAL_HOURS=.*/,
          `SCHEDULER_INTERVAL_HOURS=${intervalHours}`
        );
      } else {
        envContent += `\nSCHEDULER_INTERVAL_HOURS=${intervalHours}`;
      }
    }

    // Write back to .env file
    writeFileSync(envPath, envContent, "utf-8");

    return NextResponse.json({
      success: true,
      data: {
        message: "Scheduler config updated successfully. Restart the backend to apply changes.",
        config: {
          enabled,
          hour,
          minute,
          intervalHours,
        },
      },
    });
  } catch (error) {
    console.error("Error updating scheduler config:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update scheduler config" },
      { status: 500 }
    );
  }
}
