"""
P3-10E.18 READ-ONLY Preflight Audit
Verifies production state before applying migration 0020.
"""
import asyncio
import sys
from pathlib import Path
from sqlalchemy import text

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from backend.database import engine
from backend.config import settings


async def query_one(conn, sql, params=None):
    res = await conn.execute(text(sql), params or {})
    return res.fetchone()


async def query_scalar(conn, sql, params=None):
    res = await conn.execute(text(sql), params or {})
    return res.scalar()


async def main():
    print("=" * 70)
    print("P3-10E.18 PREFLIGHT AUDIT (READ-ONLY)")
    print("=" * 70)
    print(f"Database: {settings.database_url}")
    print(f"Time: 2026-08-11T13:20:57+07:00")
    print()

    all_pass = True

    # Use separate transactions for each check to avoid aborted transaction issues
    checks = []

    # Check 1: p3_historical_corrections must NOT exist
    async with engine.begin() as conn:
        res = await query_scalar(conn, """
            SELECT COUNT(*) FROM information_schema.tables
            WHERE table_name = 'p3_historical_corrections'
        """)
        exists = res > 0
        status = "PASS" if not exists else "FAIL"
        if exists:
            all_pass = False
        checks.append(("p3_historical_corrections table does not exist", f"Exists: {exists}", status))

    # Check 2: p3_narrative_intelligence.id=1 still references snapshot 7
    async with engine.begin() as conn:
        row = await query_one(conn, """
            SELECT id, membership_snapshot_id, availability_state
            FROM p3_narrative_intelligence WHERE id = 1
        """)
        if row:
            ok = row[1] == 7
            status = "PASS" if ok else "FAIL"
            if not ok:
                all_pass = False
            checks.append(("Intelligence id=1 references snapshot 7", f"membership_snapshot_id={row[1]}", status))
        else:
            checks.append(("Intelligence id=1 references snapshot 7", "NOT FOUND", "FAIL"))
            all_pass = False

    # Check 3: Snapshot 7 still has 0 members
    async with engine.begin() as conn:
        row = await query_one(conn, """
            SELECT id, member_count, member_digest
            FROM narrative_membership_snapshots WHERE id = 7
        """)
        if row:
            ok = row[1] == 0
            status = "PASS" if ok else "FAIL"
            if not ok:
                all_pass = False
            checks.append(("Snapshot 7 member_count=0", f"member_count={row[1]}", status))
        else:
            checks.append(("Snapshot 7 member_count=0", "NOT FOUND", "FAIL"))
            all_pass = False

    # Check 4: Snapshot 2 still has 7 members
    async with engine.begin() as conn:
        row = await query_one(conn, """
            SELECT id, member_count, member_digest
            FROM narrative_membership_snapshots WHERE id = 2
        """)
        if row:
            ok = row[1] == 7
            status = "PASS" if ok else "FAIL"
            if not ok:
                all_pass = False
            checks.append(("Snapshot 2 member_count=7", f"member_count={row[1]}", status))
        else:
            checks.append(("Snapshot 2 member_count=7", "NOT FOUND", "FAIL"))
            all_pass = False

    # Check 5: No correction records exist
    async with engine.begin() as conn:
        try:
            count = await query_scalar(conn, "SELECT COUNT(*) FROM p3_historical_corrections")
            status = "PASS" if count == 0 else "FAIL"
            if count != 0:
                all_pass = False
            checks.append(("No correction records", f"count={count}", status))
        except Exception:
            checks.append(("No correction records", "TABLE DOES NOT EXIST", "PASS"))

    # Check 6: P0-P2 tables unchanged
    async with engine.begin() as conn:
        for tbl, expected in [('narratives', 5), ('coins', 25), ('coin_narratives', 25)]:
            count = await query_scalar(conn, f"SELECT COUNT(*) FROM {tbl}")
            ok = count == expected
            status = "PASS" if ok else "FAIL"
            if not ok:
                all_pass = False
            checks.append((f"P0-P2: {tbl}", f"count={count} expected={expected}", status))

    # Check 7: Migration 0020 is idempotent
    async with engine.begin() as conn:
        cols = await conn.execute(text("""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'p3_historical_corrections'
            ORDER BY ordinal_position
        """))
        columns = cols.fetchall()
        if columns:
            checks.append(("Migration 0020 compatibility", "Table already exists", "FAIL"))
            all_pass = False
        else:
            checks.append(("Migration 0020 compatibility", "Table does not exist yet", "PASS"))

    # Check 8: Immutability triggers still active
    triggers = [
        "p3_narrative_intelligence_immutable",
        "p3_constituent_snapshots_immutable",
        "p3_constituent_snapshot_members_immutable",
        "narrative_membership_events_immutable",
        "narrative_membership_coverage_immutable",
        "narrative_membership_snapshots_immutable",
        "narrative_membership_snapshot_members_immutable",
    ]
    for trigger_name in triggers:
        async with engine.begin() as conn:
            count = await query_scalar(conn, """
                SELECT COUNT(*) FROM information_schema.triggers
                WHERE trigger_name = :trigger_name
            """, {"trigger_name": trigger_name})
            status = "PASS" if count > 0 else "FAIL"
            if count == 0:
                all_pass = False
            checks.append((f"Trigger: {trigger_name}", f"{'EXISTS' if count > 0 else 'MISSING'}", status))

    # Check 9: Snapshot 7 membership snapshot members = 0
    async with engine.begin() as conn:
        count = await query_scalar(conn, """
            SELECT COUNT(*) FROM narrative_membership_snapshot_members
            WHERE snapshot_id = 7
        """)
        status = "PASS" if count == 0 else "FAIL"
        if count != 0:
            all_pass = False
        checks.append(("Snapshot 7 has 0 members", f"count={count}", status))

    # Check 10: Snapshot 2 membership snapshot members = 7
    async with engine.begin() as conn:
        count = await query_scalar(conn, """
            SELECT COUNT(*) FROM narrative_membership_snapshot_members
            WHERE snapshot_id = 2
        """)
        status = "PASS" if count == 7 else "FAIL"
        if count != 7:
            all_pass = False
        checks.append(("Snapshot 2 has 7 members", f"count={count}", status))

    # Print all checks
    for i, (name, detail, status) in enumerate(checks, 1):
        print(f"  {i:2d}. {name}")
        print(f"      {detail} [{status}]")

    print("\n" + "=" * 70)
    if all_pass:
        print("PREFLIGHT AUDIT: PASS - Safe to apply migration 0020")
    else:
        print("PREFLIGHT AUDIT: FAIL - Do NOT apply migration 0020")
    print("=" * 70)

    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
