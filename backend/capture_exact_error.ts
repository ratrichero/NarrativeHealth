import { db } from "@/db";
import { runP3AuthoritativeExecution } from "@/lib/p3/orchestrator";

async function captureExactError() {
  try {
    const result = await runP3AuthoritativeExecution({
      narrativeId: 1,
      window: "7D",
      windowEnd: new Date("2026-08-11T00:00:00Z"),
      calculationMode: "observed",
    });
    console.log("SUCCESS:", result);
  } catch (error) {
    console.error("EXACT ERROR:");
    console.error(error);
    if (error instanceof Error) {
      console.error("Message:", error.message);
      console.error("Stack:", error.stack);
    }
  }
}

captureExactError().catch(console.error);
