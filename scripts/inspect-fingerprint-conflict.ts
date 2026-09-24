// One-off: diagnose square_fingerprints insert failures
import { db } from "@/db";
import { squareFingerprints, squarePublications, squareOpportunities } from "@/db/schema";
import { like, eq } from "drizzle-orm";

async function main() {
  // 1. Existing fingerprint rows matching the failing hash prefix
  const fps = await db
    .select()
    .from(squareFingerprints)
    .where(like(squareFingerprints.fingerprint, "3adf153a%"));
  console.log("rows with fingerprint 3adf153a*:", fps.length);
  for (const f of fps) {
    console.log("  id:", f.id, "| oppId:", f.opportunityId, "| publishedAt:", f.publishedAt);
  }

  // 2. Which opportunity ids do the failing inserts reference?
  for (const oppId of [746, 747, 748, 741, 742, 743]) {
    const [opp] = await db
      .select({ id: squareOpportunities.id, symbol: squareOpportunities.coinSymbol, status: squareOpportunities.status })
      .from(squareOpportunities)
      .where(eq(squareOpportunities.id, oppId))
      .limit(1);
    console.log("opp", oppId, ":", opp ? `exists (${opp.symbol}, status=${opp.status})` : "MISSING (FK would fail)");
  }

  // 3. Recent publications for context
  const pubs = await db
    .select({
      id: squarePublications.id,
      oppId: squarePublications.opportunityId,
      status: squarePublications.status,
      externalPostId: squarePublications.externalPostId,
      publishedAt: squarePublications.publishedAt,
    })
    .from(squarePublications)
    .orderBy(squarePublications.id)
    .limit(1000);
  const recent = pubs.slice(-8);
  for (const p of recent) {
    console.log("pub", p.id, "| opp", p.oppId, "|", p.status, "| ext:", p.externalPostId ?? "-", "|", p.publishedAt);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("ERR", e instanceof Error ? e.message : e);
  process.exit(1);
});
