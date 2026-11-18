// RADAR-CLUSTER-HISTORY: lưu cụm theo thời gian để phát hiện cụm mới,
// leader đổi, cụm mạnh lên/yếu đi. Không thêm migration:
// app_settings key "radar.cluster.history", giữ tối đa 7 ngày / 504 batch.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import type { MoverSide } from "@/lib/market/scoring";
import type { RadarSnapshot } from "@/lib/market/radar";

const KEY = "radar.cluster.history";
const MAX_BATCHES = 1008;
const KEEP_DAYS = 7;

export const CLUSTER_STRENGTH_DELTA_PCT = 1.5;

export type ClusterEventType = "new" | "leader-change" | "strengthening" | "weakening";

export interface ClusterHistoryEntry {
  at: string;
  side: MoverSide;
  clusterId: string;
  label: string;
  size: number;
  avgChangePct: number;
  totalVolumeUsd: number;
  leader: string | null;
  direction: "up" | "down";
  members: string[];
}

export interface ClusterEvent {
  type: ClusterEventType;
  at: string;
  side: MoverSide;
  clusterId: string;
  label: string;
  size: number;
  leader: string | null;
  previousLeader?: string | null;
  avgChangePct: number;
  previousAvgChangePct?: number;
  deltaPct?: number;
  direction: "up" | "down";
  members: string[];
}

interface ClusterHistoryBatch {
  at: string;
  side: MoverSide;
  clusters: ClusterHistoryEntry[];
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

export function toClusterHistoryEntries(
  snapshot: RadarSnapshot,
  at = snapshot.collectedAt
): ClusterHistoryEntry[] {
  return (snapshot.clusters ?? []).map((cluster) => ({
    at,
    side: snapshot.side,
    clusterId: cluster.id,
    label: cluster.label,
    size: cluster.size,
    avgChangePct: cluster.avgChangePct,
    totalVolumeUsd: cluster.totalVolumeUsd,
    leader: cluster.leader,
    direction: cluster.direction,
    members: cluster.members.map((member) => member.symbol),
  }));
}

/**
 * So sánh batch gần nhất của cùng side với batch hiện tại. Lần ghi đầu tiên
 * không sinh event "new" để tránh báo toàn bộ cụm khi mới bật history.
 */
export function detectClusterEvents(
  previous: ClusterHistoryEntry[],
  current: ClusterHistoryEntry[],
  minStrengthDeltaPct = CLUSTER_STRENGTH_DELTA_PCT
): ClusterEvent[] {
  if (previous.length === 0) return [];
  const previousById = new Map(previous.map((cluster) => [cluster.clusterId, cluster]));
  const events: ClusterEvent[] = [];

  for (const cluster of current) {
    const before = previousById.get(cluster.clusterId);
    if (!before) {
      events.push({
        type: "new",
        at: cluster.at,
        side: cluster.side,
        clusterId: cluster.clusterId,
        label: cluster.label,
        size: cluster.size,
        leader: cluster.leader,
        avgChangePct: cluster.avgChangePct,
        direction: cluster.direction,
        members: cluster.members,
      });
      continue;
    }

    if ((before.leader ?? null) !== (cluster.leader ?? null)) {
      events.push({
        type: "leader-change",
        at: cluster.at,
        side: cluster.side,
        clusterId: cluster.clusterId,
        label: cluster.label,
        size: cluster.size,
        leader: cluster.leader,
        previousLeader: before.leader,
        avgChangePct: cluster.avgChangePct,
        previousAvgChangePct: before.avgChangePct,
        direction: cluster.direction,
        members: cluster.members,
      });
    }

    const delta = Math.abs(cluster.avgChangePct) - Math.abs(before.avgChangePct);
    if (Math.abs(delta) >= minStrengthDeltaPct) {
      events.push({
        type: delta > 0 ? "strengthening" : "weakening",
        at: cluster.at,
        side: cluster.side,
        clusterId: cluster.clusterId,
        label: cluster.label,
        size: cluster.size,
        leader: cluster.leader,
        avgChangePct: cluster.avgChangePct,
        previousAvgChangePct: before.avgChangePct,
        deltaPct: round(delta),
        direction: cluster.direction,
        members: cluster.members,
      });
    }
  }

  return events;
}

function validSide(value: unknown): value is MoverSide {
  return value === "gainer" || value === "loser" || value === "unusual";
}

function toBatch(value: unknown): ClusterHistoryBatch | null {
  if (!value || typeof value !== "object") return null;
  const batch = value as Partial<ClusterHistoryBatch>;
  if (typeof batch.at !== "string" || !validSide(batch.side) || !Array.isArray(batch.clusters)) {
    return null;
  }
  const clusters = batch.clusters.filter((cluster): cluster is ClusterHistoryEntry => {
    if (!cluster || typeof cluster !== "object") return false;
    const entry = cluster as Partial<ClusterHistoryEntry>;
    return (
      typeof entry.clusterId === "string" &&
      typeof entry.label === "string" &&
      (typeof entry.leader === "string" || entry.leader === null) &&
      typeof entry.avgChangePct === "number" &&
      Number.isFinite(entry.avgChangePct) &&
      Array.isArray(entry.members)
    );
  });
  return { at: batch.at, side: batch.side, clusters };
}

async function readHistory(): Promise<ClusterHistoryBatch[]> {
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
    if (!Array.isArray(row?.value)) return [];
    return row.value
      .map(toBatch)
      .filter((batch): batch is ClusterHistoryBatch => batch !== null);
  } catch (error) {
    console.warn(
      "[RADAR-CLUSTER-HISTORY] Không đọc được history:",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}

async function writeHistory(batches: ClusterHistoryBatch[]): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: KEY, value: batches, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: batches, updatedAt: new Date() },
    });
}

/**
 * Ghi snapshot của cả 3 side trong một lần đọc/ghi, rồi trả các transition mới.
 * Lỗi DB không được làm hỏng radar/track record.
 */
export async function recordClusterSnapshots(snapshots: RadarSnapshot[]): Promise<ClusterEvent[]> {
  if (process.env.NODE_ENV === "test" || process.env.RADAR_DEMO === "1") return [];

  try {
    const at = new Date().toISOString();
    const history = await readHistory();
    const latestBySide = new Map<MoverSide, ClusterHistoryEntry[]>();
    for (const batch of history) latestBySide.set(batch.side, batch.clusters);

    const events: ClusterEvent[] = [];
    const freshBatches: ClusterHistoryBatch[] = [];
    for (const snapshot of snapshots) {
      const current = toClusterHistoryEntries(snapshot, at);
      if (current.length === 0) continue;
      const previous = latestBySide.get(snapshot.side) ?? [];
      events.push(...detectClusterEvents(previous, current));
      latestBySide.set(snapshot.side, current);
      freshBatches.push({ at, side: snapshot.side, clusters: current });
    }

    if (freshBatches.length === 0) return events;
    const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
    const kept = history
      .filter((batch) => {
        const timestamp = Date.parse(batch.at);
        return Number.isFinite(timestamp) && timestamp >= cutoff;
      })
      .concat(freshBatches)
      .slice(-MAX_BATCHES);
    await writeHistory(kept);
    return events;
  } catch (error) {
    console.warn(
      "[RADAR-CLUSTER-HISTORY] Không ghi được history:",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}
