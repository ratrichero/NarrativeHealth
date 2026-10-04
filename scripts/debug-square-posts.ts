// One-off diagnostic (not committed): print the full text of the latest
// Square publication + length stats (assess "too short LLM content").
import { db } from "@/db";
import { squarePublications } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

async function main() {
  const rows = await db
    .select({
      id: squarePublications.id,
      publishedAt: squarePublications.publishedAt,
      llmUsed: squarePublications.llmUsed,
      snapshot: squarePublications.contentSnapshot,
    })
    .from(squarePublications)
    .where(eq(squarePublications.status, "PUBLISHED"))
    .orderBy(desc(squarePublications.publishedAt))
    .limit(6);

  console.log("=== LATEST POST FULL TEXT ===\n");
  const latest = rows[0];
  if (latest) {
    const snap = (latest.snapshot ?? {}) as Record<string, unknown>;
    console.log(String(snap.text ?? ""));
    console.log("\n=== STATS (6 latest) ===");
  }
  for (const r of rows) {
    const snap = (r.snapshot ?? {}) as Record<string, unknown>;
    const text = String(snap.text ?? "");
    const sentences = text.split(/[.!?]\s/).filter((s) => s.trim().length > 0).length;
    console.log(
      String(r.publishedAt).slice(0, 16),
      "|",
      r.llmUsed ? String(snap.llmProvider ?? "llm") : "template",
      "| chars:",
      String(text.length).padStart(4),
      "| sentences:",
      sentences
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("ERR", e instanceof Error ? e.message : e);
  process.exit(1);
});
