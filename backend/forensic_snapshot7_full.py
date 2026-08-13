"""
P3-10E.14 Snapshot 7 Forensic Audit (READ-ONLY)
Comprehensive forensic audit of the invalid snapshot 7 relationship.
"""
import asyncio
import sys
from pathlib import Path
from sqlalchemy import text

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from backend.database import engine
from backend.config import settings


async def main():
    print("=" * 70)
    print("P3-10E.14 SNAPSHOT 7 FORENSIC AUDIT (READ-ONLY)")
    print("=" * 70)
    print(f"Database: {settings.database_url}")
    print()

    async with engine.begin() as conn:
        # ===== A. Snapshot 7 Complete Details =====
        print("## A. SNAPSHOT 7 DETAILS")
        res = await conn.execute(text("""
            SELECT id, narrative_id, window_end, snapshot_revision, membership_mode,
                   membership_source, ledger_cutoff_event_id, member_count, member_digest,
                   captured_at, provenance
            FROM narrative_membership_snapshots
            WHERE id = 7
        """))
        row = res.fetchone()
        if row:
            print(f"  snapshot_id          = {row[0]}")
            print(f"  narrative_id         = {row[1]}")
            print(f"  window_end           = {row[2]}")
            print(f"  snapshot_revision    = {row[3]}")
            print(f"  membership_mode      = {row[4]}")
            print(f"  membership_source    = {row[5]}")
            print(f"  ledger_cutoff_event_id = {row[6]}")
            print(f"  member_count         = {row[7]}")
            print(f"  member_digest        = {row[8]}")
            print(f"  captured_at          = {row[9]}")
            print(f"  provenance           = {row[10]}")
        else:
            print("  NOT FOUND")

        # Snapshot 7 member IDs
        print("\n  Snapshot 7 member IDs:")
        res = await conn.execute(text("""
            SELECT coin_id FROM narrative_membership_snapshot_members
            WHERE snapshot_id = 7 ORDER BY coin_id
        """))
        members7 = res.fetchall()
        print(f"  Count: {len(members7)}")
        for m in members7:
            print(f"    coin_id={m[0]}")

        # ===== B. P3 Intelligence Record id=1 =====
        print("\n## B. P3_NARRATIVE_INTELLIGENCE ID=1 DETAILS")
        res = await conn.execute(text("""
            SELECT id, narrative_id, window_end, period_start, period_end,
                   algorithm_key, algorithm_version, rule_version_id, feature_version_id,
                   score_config_id, membership_snapshot_id, calculation_mode,
                   availability_state, confidence, calculated_at, persisted_at,
                   provenance
            FROM p3_narrative_intelligence
            WHERE id = 1
        """))
        row = res.fetchone()
        if row:
            print(f"  id                   = {row[0]}")
            print(f"  narrative_id         = {row[1]}")
            print(f"  window_end           = {row[2]}")
            print(f"  period_start         = {row[3]}")
            print(f"  period_end           = {row[4]}")
            print(f"  algorithm_key        = {row[5]}")
            print(f"  algorithm_version    = {row[6]}")
            print(f"  rule_version_id      = {row[7]}")
            print(f"  feature_version_id   = {row[8]}")
            print(f"  score_config_id      = {row[9]}")
            print(f"  membership_snapshot_id = {row[10]}")
            print(f"  calculation_mode     = {row[11]}")
            print(f"  availability_state   = {row[12]}")
            print(f"  confidence           = {row[13]}")
            print(f"  calculated_at        = {row[14]}")
            print(f"  persisted_at         = {row[15]}")
            print(f"  provenance           = {row[16]}")
        else:
            print("  NOT FOUND")

        # ===== C. Baseline Snapshot 2 Verification =====
        print("\n## C. BASELINE SNAPSHOT 2 VERIFICATION")
        res = await conn.execute(text("""
            SELECT id, narrative_id, window_end, snapshot_revision, membership_mode,
                   membership_source, ledger_cutoff_event_id, member_count, member_digest,
                   captured_at, provenance
            FROM narrative_membership_snapshots
            WHERE id = 2
        """))
        row = res.fetchone()
        if row:
            print(f"  snapshot_id          = {row[0]}")
            print(f"  narrative_id         = {row[1]}")
            print(f"  window_end           = {row[2]}")
            print(f"  snapshot_revision    = {row[3]}")
            print(f"  membership_mode      = {row[4]}")
            print(f"  membership_source    = {row[5]}")
            print(f"  ledger_cutoff_event_id = {row[6]}")
            print(f"  member_count         = {row[7]}")
            print(f"  member_digest        = {row[8]}")
            print(f"  captured_at          = {row[9]}")
            print(f"  provenance           = {row[10]}")
        else:
            print("  NOT FOUND")

        # Snapshot 2 member IDs
        print("\n  Snapshot 2 member IDs:")
        res = await conn.execute(text("""
            SELECT coin_id, is_primary FROM narrative_membership_snapshot_members
            WHERE snapshot_id = 2 ORDER BY coin_id
        """))
        members2 = res.fetchall()
        print(f"  Count: {len(members2)}")
        for m in members2:
            print(f"    coin_id={m[0]}, is_primary={m[1]}")

        # Coverage relationship
        print("\n## COVERAGE RELATIONSHIP")
        res = await conn.execute(text("""
            SELECT id, narrative_id, history_coverage_start, source, verified_by, provenance
            FROM narrative_membership_coverage
            WHERE narrative_id = 1
        """))
        for row in res.fetchall():
            print(f"  coverage_id={row[0]}, narrative={row[1]}, start={row[2]}, source={row[3]}, verified_by={row[4]}")
            print(f"    provenance={row[5]}")

        # ===== D. All FK References to Snapshot 7 =====
        print("\n## D. ALL REFERENCES TO SNAPSHOT 7 ACROSS DATABASE")

        # D1: p3_narrative_intelligence
        print("\n  D1. p3_narrative_intelligence references:")
        res = await conn.execute(text("""
            SELECT id, narrative_id, window_end, algorithm_key, algorithm_version,
                   membership_snapshot_id, availability_state
            FROM p3_narrative_intelligence WHERE membership_snapshot_id = 7
        """))
        rows = res.fetchall()
        print(f"    Count: {len(rows)}")
        for r in rows:
            print(f"    id={r[0]}, narrative={r[1]}, window_end={r[2]}, algo={r[3]}/{r[4]}, snapshot={r[5]}, availability={r[6]}")

        # D2: p3_constituent_snapshots (via intelligence)
        print("\n  D2. p3_constituent_snapshots referencing intelligence id=1:")
        res = await conn.execute(text("""
            SELECT cs.id, cs.intelligence_id, cs.member_count, cs.membership_source, cs.provenance
            FROM p3_constituent_snapshots cs
            WHERE cs.intelligence_id = 1
        """))
        rows = res.fetchall()
        print(f"    Count: {len(rows)}")
        for r in rows:
            print(f"    id={r[0]}, intelligence={r[1]}, member_count={r[2]}, source={r[3]}")
            print(f"      provenance={r[4]}")

        # D3: p3_constituent_snapshot_members
        print("\n  D3. p3_constituent_snapshot_members for intelligence id=1's constituent snapshots:")
        res = await conn.execute(text("""
            SELECT csm.snapshot_id, COUNT(*) as member_count
            FROM p3_constituent_snapshot_members csm
            JOIN p3_constituent_snapshots cs ON cs.id = csm.snapshot_id
            WHERE cs.intelligence_id = 1
            GROUP BY csm.snapshot_id
        """))
        rows = res.fetchall()
        for r in rows:
            print(f"    snapshot_id={r[0]}, member_count={r[1]}")

        # D4: p3_leadership_members
        print("\n  D4. p3_leadership_members referencing intelligence id=1:")
        res = await conn.execute(text("""
            SELECT COUNT(*) FROM p3_leadership_members WHERE intelligence_id = 1
        """))
        count = res.scalar()
        print(f"    Count: {count}")

        # D5: Check all tables that might reference snapshot 7
        # Check the FK constraint from p3_narrative_intelligence.membership_snapshot_id
        print("\n  D5. FK constraint on p3_narrative_intelligence.membership_snapshot_id:")
        res = await conn.execute(text("""
            SELECT conname, pg_get_constraintdef(oid)
            FROM pg_constraint
            WHERE conrelid = 'p3_narrative_intelligence'::regclass
            AND contype = 'f'
            AND conname LIKE '%membership%'
        """))
        for r in res.fetchall():
            print(f"    {r[0]}: {r[1]}")

        # D6: Timescale - count p3_narrative_intelligence total
        print("\n  D6. All p3_narrative_intelligence records:")
        res = await conn.execute(text("""
            SELECT id, narrative_id, window_end, membership_snapshot_id, algorithm_key, availability_state, persisted_at
            FROM p3_narrative_intelligence ORDER BY id
        """))
        for r in res.fetchall():
            print(f"    id={r[0]}, narrative={r[1]}, window_end={r[2]}, snapshot={r[3]}, algo={r[4]}, availability={r[5]}, persisted={r[6]}")

        # D7: Check membership event count
        print("\n  D7. Membership events count (context):")
        res = await conn.execute(text("SELECT COUNT(*) FROM narrative_membership_events"))
        count = res.scalar()
        print(f"    Total events: {count}")

        # D8: Check current coin_narratives (unchanged?)
        print("\n  D8. coin_narratives for narrative 1 (current):")
        res = await conn.execute(text("""
            SELECT coin_id, is_primary FROM coin_narratives
            WHERE narrative_id = 1 ORDER BY coin_id
        """))
        rows = res.fetchall()
        print(f"    Count: {len(rows)}")
        for r in rows:
            print(f"    coin_id={r[0]}, is_primary={r[1]}")

    print("\n" + "=" * 70)
    print("FORENSIC AUDIT COMPLETE")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())