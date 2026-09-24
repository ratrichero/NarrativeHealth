// One-off: dump full errorSummary from recent square_pipeline_executions
import { db } from "@/db";
import { squarePipelineExecutions } from "@/db/schema";
import { desc, isNotNull } from "drizzle-orm";

async function main() {
  const rows = await db
    .select({
      id: squarePipelineExecutions.id,
      completedAt: squarePipelineExecutions.completedAt,
      errorSummary: squarePipelineExecutions.errorSummary,
    })
    .from(squarePipelineExecutions)
    .where(isNotNull(squarePipelineExecutions.errorSummary))
    .orderBy(desc(squarePipelineExecutions.completedAt))
    .limit(3);

  for (const r of rows) {
    console.log("=== execution", r.id, "@", r.completedAt?.toISOString?.() ?? r.completedAt, "===");
    const es = r.errorSummary as { errors?: string[] } | null;
    for (const e of es?.errors ?? []) {
      console.log(e.slice(0, 900));
      console.log("---");
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("ERR", e instanceof Error ? e.message : e);
  process.exit(1);
});
