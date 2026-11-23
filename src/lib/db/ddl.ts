// DDL-01 — derive test DDL from the Drizzle schema instead of hand-copying it.
//
// The settlement test builds its Postgres schema from a hand-written string.
// Migration 0039 added `picked_origin` to `schema.ts` and to the production
// migration, but not to that string — the test then failed with `column
// "picked_origin" does not exist` only *after* the feature was committed. A
// hand-written DDL is a second schema that silently drifts.
//
// `alignDdlWithSchema` closes that hole: it reads the real column list from the
// Drizzle table and appends `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for any
// column the DDL forgot. The test keeps its hand-written defaults (which the
// real schema cannot express cheaply) but can no longer miss a column.

import { getTableColumns } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

/** `CREATE TABLE` blocks this helper understands end with `\n  );`. */
function createTableBlock(ddl: string, tableName: string): string | null {
  const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = new RegExp(
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:"?\\w+"?\\.)?"?${escaped}"?\\s*\\(`,
    "i"
  ).exec(ddl);
  if (!start) return null;
  const open = start.index + start[0].length - 1;
  let depth = 0;
  for (let i = open; i < ddl.length; i += 1) {
    const ch = ddl[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return ddl.slice(open + 1, i);
    }
  }
  return null;
}

/** Column names declared inside the DDL's CREATE TABLE for `tableName`. */
export function declaredColumns(ddl: string, tableName: string): Set<string> {
  const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = createTableBlock(ddl, tableName);
  const out = new Set<string>();
  // Cột thêm bằng ALTER (chính là thứ alignDdlWithSchema sinh ra) cũng được
  // tính — nếu không, gọi align lần hai sẽ sinh lại đúng những ALTER đó.
  const alterPattern = new RegExp(
    `ALTER\\s+TABLE\\s+(?:"?\\w+"?\\.)?"?${escaped}"?\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"?([a-z_][a-z0-9_]*)"?`,
    "gi"
  );
  for (const match of ddl.matchAll(alterPattern)) {
    out.add(match[1].toLowerCase());
  }
  if (!block) return out;
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK)\b/i.test(line)) continue;
    const match = /^"?([a-z_][a-z0-9_]*)"?\s+/i.exec(line);
    if (!match) continue;
    out.add(match[1].toLowerCase());
  }
  return out;
}

/** Schema columns of `table`, in declaration order, with their SQL types. */
export function schemaColumns(table: PgTable): Array<{
  name: string;
  sqlType: string;
  notNull: boolean;
}> {
  return Object.values(getTableColumns(table)).map((column) => ({
    name: column.name.toLowerCase(),
    sqlType: column.getSQLType(),
    notNull: Boolean(column.notNull),
  }));
}

/**
 * ALTER statements for every schema column the hand-written DDL does not
 * declare. Empty when the DDL is complete (the normal case).
 */
export function missingColumnAlters(table: PgTable, ddl: string): string[] {
  const config = getTableConfig(table);
  const declared = declaredColumns(ddl, config.name);
  return schemaColumns(table)
    .filter((column) => !declared.has(column.name))
    .map(
      (column) =>
        `ALTER TABLE ${config.name} ADD COLUMN IF NOT EXISTS ${column.name} ${column.sqlType};`
    );
}

/**
 * DDL + drift fixes. Deterministic and idempotent, so a test can call it at
 * module scope and get exactly the production column set.
 */
export function alignDdlWithSchema(table: PgTable, ddl: string): string {
  const alters = missingColumnAlters(table, ddl);
  if (alters.length === 0) return ddl;
  return `${ddl}\n-- DDL-01: cột có trong schema.ts nhưng thiếu ở DDL viết tay\n${alters.join("\n")}\n`;
}
