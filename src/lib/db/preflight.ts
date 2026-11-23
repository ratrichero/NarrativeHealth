// PREFLIGHT-01 — deploy-order check for columns the code now needs.
//
// ORIGIN-01 reads/writes `top_recommendation_picks.picked_origin`. If the new
// build is deployed before migration 0039, Drizzle's INSERT lists the column
// and Postgres rejects every write with `column "picked_origin" ... does not
// exist` — but only at the first pick insert, i.e. after the deploy looked
// healthy. A preflight turns that into an explicit, readable check.
//
// Pure core (`missingRequiredColumns`) + one thin DB reader so the rule is
// testable without a database.

import { sql } from "drizzle-orm";
import { db } from "@/db";

export interface RequiredColumn {
  table: string;
  column: string;
  /** Migration that adds it — the deploy order the operator must fix. */
  migration: string;
  /** Which feature breaks without it. */
  feature: string;
}

/**
 * Columns added by recent migrations that the current code assumes. Keep this
 * list to columns whose absence makes a *write* fail (additive nullable
 * columns), not every column ever added.
 */
export const REQUIRED_SCHEMA_COLUMNS: readonly RequiredColumn[] = [
  {
    table: "top_recommendation_picks",
    column: "picked_origin",
    migration: "0039_pick_origin.sql",
    feature: "ORIGIN-01 (pick provenance)",
  },
  {
    table: "backtest_horizon_results",
    column: "horizon_days",
    migration: "0038_backtest_horizon_results.sql",
    feature: "BT-10 (per-horizon results)",
  },
];

export type SchemaInventory = Record<string, readonly string[]>;

/** Required columns missing from an `information_schema` inventory. */
export function missingRequiredColumns(
  inventory: SchemaInventory,
  required: readonly RequiredColumn[] = REQUIRED_SCHEMA_COLUMNS
): RequiredColumn[] {
  return required.filter((entry) => {
    const columns = inventory[entry.table];
    // Table missing entirely counts as missing: the migration never ran.
    if (!columns) return true;
    return !columns.some((column) => column.toLowerCase() === entry.column.toLowerCase());
  });
}

export interface SchemaPreflight {
  ok: boolean;
  /** Missing columns with the migration that adds them. */
  missing: RequiredColumn[];
  /** Human-readable deploy-order instruction when `ok` is false. */
  action: string | null;
  checkedAt: string;
  /** DB error message when the inventory could not be read. */
  error?: string;
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

/** Đọc inventory cột của các bảng liên quan từ Postgres. */
export async function readSchemaInventory(
  tables: readonly string[] = [
    ...new Set(REQUIRED_SCHEMA_COLUMNS.map((entry) => entry.table)),
  ]
): Promise<SchemaInventory> {
  if (tables.length === 0) return {};
  const result = await db.execute(sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name IN (${sql.join(
        tables.map((table) => sql`${table}`),
        sql`, `
      )})
    ORDER BY table_name, ordinal_position
  `);
  const inventory: Record<string, string[]> = {};
  for (const row of rowsOf(result)) {
    const table = String(row.table_name ?? "");
    const column = String(row.column_name ?? "");
    if (!table || !column) continue;
    (inventory[table] ??= []).push(column);
  }
  return inventory;
}

/**
 * Chạy preflight. Không throw: health endpoint phải trả lời được cả khi DB
 * chết — đó chính là lúc cần nó nhất.
 */
export async function preflightTrackRecordSchema(
  now = new Date()
): Promise<SchemaPreflight> {
  const checkedAt = now.toISOString();
  try {
    const inventory = await readSchemaInventory();
    const missing = missingRequiredColumns(inventory);
    const migrations = [...new Set(missing.map((entry) => entry.migration))];
    return {
      ok: missing.length === 0,
      missing,
      action:
        missing.length === 0
          ? null
          : `Chạy migration trước khi deploy: ${migrations.join(", ")}.`,
      checkedAt,
    };
  } catch (error) {
    return {
      ok: false,
      missing: [],
      action: "Không đọc được information_schema — kiểm tra kết nối DB và migration.",
      checkedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
