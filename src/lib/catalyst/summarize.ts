// RADAR-06 — tóm tắt facts-only.
// Nguyên tắc: LLM chỉ diễn đạt lại facts; validator từ chối câu suy đoán nhân quả
// hoặc thêm số lạ; lỗi/không có key → template. Không có fact → không có summary.

import { generateMoversWithLLM } from "@/lib/square/content-generator";
import { peekRadarRuntimeConfig } from "@/lib/settings/radar-config";
import {
  catalystLlmDailyLimit,
  consumeCatalystLlmQuota,
  recordCatalystLlmTokens,
  releaseCatalystLlmQuota,
} from "./llm-quota";
import type { CatalystFact, CatalystSyncInfo } from "./types";

// \b của JS chỉ hiểu ASCII nên không bắt được "vì"/"bán"; dùng biên theo \p{L}.
const CAUSAL_BLACKLIST =
  /(^|[^\p{L}])(vì|bởi|do|nhờ|nguyên nhân|động lực|catalyst chính|dẫn đến|kéo theo|sẽ|có thể|dự kiến|kỳ vọng|tác động tích cực|tác động tiêu cực|đẩy giá|hỗ trợ giá)(?=[^\p{L}]|$)/iu;
const TRADE_BLACKLIST =
  /(^|[^\p{L}])(buy|sell|long|short|mua|bán)(?=[^\p{L}]|$)/iu;

import { catalystSourceLabel, catalystTypeLabel } from "./labels";

export {
  catalystSourceLabel,
  catalystSyncSourceLabel,
  catalystTypeLabel,
} from "./labels";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString().slice(0, 10).split("-").reverse().join("/");
}

/** Template thuần facts: không suy đoán, không nhân quả. */
export function buildTemplateSummary(symbol: string, facts: CatalystFact[]): string | null {
  if (facts.length === 0) return null;
  const parts = facts.map((fact) => {
    const when = formatDate(fact.eventDate ?? fact.publishedAt);
    return `${catalystTypeLabel(fact.type)}: ${fact.title}${when ? ` (${when})` : ""}`;
  });
  return `$${symbol.toUpperCase()} có ${facts.length} catalyst khớp — ${parts.join("; ")}. Nguồn không nêu lý do biến động giá.`;
}

function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", ".").replace(/\.0+$/, ""));
}

/**
 * Trả text đã hợp lệ, hoặc null nếu vi phạm. Dùng làm validate callback cho
 * `generateMoversWithLLM` (hàm đó trả `text | null`).
 */
export function validateCatalystSummary(text: string, symbol: string, facts: CatalystFact[]): string | null {
  const trimmed = text.trim().replace(/^["'`]+|["'`]+$/g, "");
  if (trimmed.length < 15 || trimmed.length > 600) return null;
  if (CAUSAL_BLACKLIST.test(trimmed)) return null;
  if (TRADE_BLACKLIST.test(trimmed)) return null;

  const sym = symbol.toUpperCase();
  if (!new RegExp(`(^|[^A-Z0-9])${sym}([^A-Z0-9]|$)`).test(trimmed.toUpperCase())) return null;

  const allowed = new Set(numbersIn(JSON.stringify(facts)));
  for (const number of numbersIn(trimmed)) {
    if (!allowed.has(number)) return null;
  }

  const sentences = trimmed.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  if (sentences.length > 2) return null;

  return trimmed;
}

export function buildCatalystPrompt(symbol: string, facts: CatalystFact[]): string {
  const lines = facts.map(
    (fact, index) =>
      `[f${index + 1}] type=${fact.type} | source=${catalystSourceLabel(fact.source)} | title="${fact.title}"` +
      ` | publishedAt=${fact.publishedAt}` +
      (fact.eventDate ? ` | eventDate=${fact.eventDate}` : "") +
      (fact.facts ? ` | facts=${JSON.stringify(fact.facts)}` : "")
  );

  return [
    "Bạn là bộ lọc dữ kiện, KHÔNG phải nhà phân tích.",
    "Chỉ diễn đạt lại các FACT dưới đây bằng tiếng Việt, tối đa 2 câu, không markdown, không link.",
    "TUYỆT ĐỐI KHÔNG suy đoán nguyên nhân, động lực, dự đoán giá, khuyến nghị mua/bán.",
    "KHÔNG thêm số/ngày không có trong facts.",
    'Nếu facts không nêu lý do biến động, phải nói rõ "nguồn không nêu lý do".',
    `Bắt buộc nhắc ticker ${symbol.toUpperCase()} ít nhất một lần.`,
    "",
    `SYMBOL: ${symbol.toUpperCase()}`,
    "FACTS:",
    ...lines,
  ].join("\n");
}

export interface CatalystSummaryResult {
  text: string | null;
  mode: "llm" | "template" | "none";
  provider?: string;
  note: string;
}

/**
 * Note khi không có fact khớp — phải phản ánh trạng thái nguồn, vì “chưa đồng bộ”
 * và “đã kiểm tra nhưng không khớp” là hai kết luận khác nhau. Không truyền sync
 * (caller cũ/test) thì giữ câu “đã kiểm tra, không khớp”.
 */
export function emptyCatalystNote(sync?: CatalystSyncInfo): string {
  if (sync?.state === "never_synced") {
    return "Chưa đồng bộ nguồn catalyst lần nào — chưa thể kết luận coin này có catalyst hay không.";
  }
  if (sync?.state === "sources_failed") {
    const failed = sync.failedSources.join(", ") || "không rõ nguồn";
    return `Đồng bộ nguồn catalyst đang lỗi (${failed}) — chưa thể kết luận coin này có catalyst hay không.`;
  }
  return "Chưa tìm thấy catalyst khớp trong cửa sổ thời gian của từng loại nguồn.";
}

export async function summarizeCatalysts(
  symbol: string,
  facts: CatalystFact[],
  sync?: CatalystSyncInfo
): Promise<CatalystSummaryResult> {
  if (facts.length === 0) {
    return {
      text: null,
      mode: "none",
      note: emptyCatalystNote(sync),
    };
  }

  const template = buildTemplateSummary(symbol, facts);
  const llmEnabled = peekRadarRuntimeConfig().catalystLlmEnabled;
  if (!llmEnabled) {
    return { text: template, mode: "template", note: "LLM tắt (CATALYST_LLM_ENABLED=0) — template facts." };
  }

  // Trần chi phí theo ngày (CATALYST_LLM_DAILY_LIMIT, app_settings). Vượt trần →
  // template facts-only, KHÔNG gọi provider. LLM mặc định bật nên cap này là lớp
  // chặn chi phí duy nhất ngoài cache 30 phút của route.
  const limit = catalystLlmDailyLimit();
  const quota = await consumeCatalystLlmQuota(limit);
  if (!quota.allowed) {
    return {
      text: template,
      mode: "template",
      note:
        quota.reason === "storage"
          ? "Không đọc/ghi được quota LLM (app_settings) — dùng template facts."
          : `Đã đạt trần CATALYST_LLM_DAILY_LIMIT (${quota.limit} lượt/ngày) — dùng template facts.`,
    };
  }

  const prompt = buildCatalystPrompt(symbol, facts);
  // Provider trả text nhưng validator loại hết → không có output nào dùng được,
  // hoàn lại lượt vừa cấp để budget không mất vô ích.
  let rejectedByValidator = false;
  const llm = await generateMoversWithLLM(
    prompt,
    (text) => {
      const validated = validateCatalystSummary(text, symbol, facts);
      if (!validated) rejectedByValidator = true;
      return validated;
    },
    "catalyst"
  );
  if (llm) {
    // W6: đo chi phí thật (token/lần tóm tắt) — best-effort, không chặn output.
    await recordCatalystLlmTokens(llm.tokens);
    return { text: llm.text, mode: "llm", provider: llm.provider, note: "AI tóm tắt từ facts của nguồn." };
  }
  // `limit <= 0` = không giới hạn và KHÔNG ghi usage, nên không có lượt nào để
  // hoàn — release lúc này sẽ trừ nhầm lượt của request khác trong ngày.
  if (quota.limit > 0 && rejectedByValidator) {
    await releaseCatalystLlmQuota(quota.date);
  }
  return {
    text: template,
    mode: "template",
    note: "LLM không khả dụng hoặc output không qua validator — dùng template facts.",
  };
}
