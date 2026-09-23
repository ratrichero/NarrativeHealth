// One-off: inspect recent Square publications (provider + snippet)
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

  for (const r of rows) {
    const snap = (r.snapshot ?? {}) as Record<string, unknown>;
    const text = String(snap.text ?? "");
    console.log(
      r.publishedAt instanceof Date ? r.publishedAt.toISOString() : String(r.publishedAt),
      "|",
      r.llmUsed ? String(snap.llmProvider ?? "llm") : "template",
      "|",
      text.replace(/\n/g, " ⏎ ").slice(0, 160)
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("ERR", e instanceof Error ? e.message : e);
  process.exit(1);
});
