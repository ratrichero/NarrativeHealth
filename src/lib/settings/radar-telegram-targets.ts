// Cấu hình kênh Telegram của Radar — dùng chung cho env fallback
// (`RADAR_TELEGRAM_TARGETS`) và cấu hình runtime trong `app_settings`.
//
// Env nhận hai dạng (giữ nguyên hành vi cũ):
//   RADAR_TELEGRAM_TARGETS='[{"chatId":"-1001","label":"public"}]'
//   RADAR_TELEGRAM_TARGETS='-1001,-1002:42,123456789'
//
// DB lưu mảng target đã chuẩn hoá; entry hỏng bị bỏ khi đọc từ env/DB cũ, còn
// khi admin lưu thì `coerceRadarTelegramTargets` từ chối entry hỏng để không
// âm thầm mất kênh.

export const RADAR_TELEGRAM_TARGETS_ENV = "RADAR_TELEGRAM_TARGETS";

/** Trần số kênh tĩnh để một payload admin không phình vô hạn. */
export const MAX_RADAR_TELEGRAM_TARGETS = 50;

export interface RadarTelegramTarget {
  chatId: string;
  /** Topic trong group forum (`message_thread_id`). */
  threadId?: number;
  /** Nhãn để đọc log/config — không vào nội dung tin. */
  label?: string;
  /** Ngưỡng score riêng cho kênh này; thiếu thì dùng alertMinScore chung. */
  minScore?: number;
}

function parseTelegramTarget(entry: unknown): RadarTelegramTarget | null {
  if (typeof entry === "string") {
    const [chatId, threadId] = entry.split(":").map((part) => part.trim());
    return parseTelegramTarget({ chatId, threadId });
  }
  if (!entry || typeof entry !== "object") return null;

  const raw = entry as Record<string, unknown>;
  const chatId = String(raw.chatId ?? raw.chat_id ?? "").trim();
  if (!/^-?\d{1,20}$/.test(chatId)) return null;

  const rawThread = raw.threadId ?? raw.thread_id ?? raw.message_thread_id;
  const thread =
    rawThread === undefined || rawThread === null || rawThread === ""
      ? NaN
      : Number(rawThread);
  const threadId = Number.isInteger(thread) && thread > 0 ? thread : undefined;

  const rawLabel = raw.label;
  const label =
    typeof rawLabel === "string" && rawLabel.trim() ? rawLabel.trim().slice(0, 80) : undefined;

  const rawScore = raw.minScore ?? raw.min_score;
  const score =
    rawScore === undefined || rawScore === null || rawScore === "" ? NaN : Number(rawScore);
  const minScore =
    Number.isFinite(score) && score >= 0 && score <= 100 ? Math.round(score) : undefined;

  return {
    chatId,
    ...(threadId !== undefined ? { threadId } : {}),
    ...(label ? { label } : {}),
    ...(minScore !== undefined ? { minScore } : {}),
  };
}

/** Chuẩn hoá danh sách target; entry hỏng bị bỏ, trùng chat+topic bị gộp. */
export function normalizeRadarTelegramTargets(entries: unknown[]): RadarTelegramTarget[] {
  const seen = new Set<string>();
  const targets: RadarTelegramTarget[] = [];
  for (const entry of entries) {
    const target = parseTelegramTarget(entry);
    if (!target) continue;
    const key = `${target.chatId}:${target.threadId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
    if (targets.length >= MAX_RADAR_TELEGRAM_TARGETS) break;
  }
  return targets;
}

/** Parse env (JSON array hoặc danh sách gọn). Rỗng/hỏng → [] như trước. */
export function parseRadarTelegramTargets(
  raw: string | null | undefined
): RadarTelegramTarget[] {
  const value = raw?.trim();
  if (!value) return [];

  let entries: unknown[];
  if (value.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(value);
      entries = Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  } else {
    entries = value
      .split(/[,;\n]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return normalizeRadarTelegramTargets(entries);
}

/**
 * Ép giá trị admin nhập (mảng hoặc chuỗi JSON) thành target hợp lệ.
 * Khác parser env: entry hỏng/trùng bị coi là lỗi thay vì bỏ im lặng.
 */
export function coerceRadarTelegramTargets(
  raw: unknown,
  label = "Kênh Telegram"
): RadarTelegramTarget[] {
  if (raw === null || raw === undefined || raw === "") return [];

  let entries: unknown[];
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return [];
    if (!text.startsWith("[")) {
      const parsed = parseRadarTelegramTargets(text);
      if (parsed.length === 0) {
        throw new Error(`${label}: không có chatId hợp lệ.`);
      }
      return parsed;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`${label}: JSON không hợp lệ.`);
    }
    if (!Array.isArray(parsed)) throw new Error(`${label}: phải là mảng target.`);
    entries = parsed;
  } else if (Array.isArray(raw)) {
    entries = raw;
  } else {
    throw new Error(`${label}: phải là mảng target.`);
  }

  if (entries.length > MAX_RADAR_TELEGRAM_TARGETS) {
    throw new Error(`${label}: tối đa ${MAX_RADAR_TELEGRAM_TARGETS} kênh.`);
  }
  const targets = normalizeRadarTelegramTargets(entries);
  if (targets.length !== entries.length) {
    throw new Error(`${label}: có entry không hợp lệ hoặc trùng chat+topic.`);
  }
  return targets;
}

/**
 * So sánh không phụ thuộc thứ tự field/thứ tự kênh — dùng cho UI biết giá
 * trị có trùng env hay không (trùng thì bỏ ghim thay vì ghi DB).
 */
export function canonicalRadarTelegramTargets(targets: RadarTelegramTarget[]): string {
  return JSON.stringify(
    [...targets]
      .sort((a, b) =>
        `${a.chatId}:${a.threadId ?? ""}`.localeCompare(`${b.chatId}:${b.threadId ?? ""}`)
      )
      .map((target) => ({
        chatId: target.chatId,
        ...(target.threadId !== undefined ? { threadId: target.threadId } : {}),
        ...(target.label ? { label: target.label } : {}),
        ...(target.minScore !== undefined ? { minScore: target.minScore } : {}),
      }))
  );
}
