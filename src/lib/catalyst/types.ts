// RADAR-06 catalyst layer — kiểu dữ liệu chung.
// Mọi fact phải có sourceUrl: panel “vì sao volume bất thường” chỉ hiển thị dữ kiện
// truy được về nguồn, không suy đoán.

export type CatalystType =
  | "LISTING"
  | "DELISTING"
  | "FUTURES_LAUNCH"
  | "MONITORING_TAG"
  | "UNLOCK"
  | "NEWS";

export type CatalystSource =
  | "BINANCE_ANNOUNCEMENT"
  | "RSS_COINDESK"
  | "RSS_COINTELEGRAPH"
  | "RSS_DECRYPT"
  | "RSS_THEBLOCK"
  | "EVENT_RISKS_UNLOCK";

export interface CatalystFact {
  type: CatalystType;
  source: CatalystSource;
  /** Khoá ổn định theo nguồn: article code / RSS guid / unlock key. */
  externalId: string;
  /** Tiêu đề gốc, không biên tập. */
  title: string;
  sourceUrl: string;
  /** Ticker base (không có USDT), best-effort từ tiêu đề. */
  symbols: string[];
  /** ISO UTC. */
  publishedAt: string;
  /** Ngày hiệu lực nếu nguồn nêu (delist/unlock), dạng YYYY-MM-DD. */
  eventDate?: string | null;
  /** Facts đã trích, chỉ những gì nguồn nói. */
  facts?: Record<string, unknown>;
  raw?: unknown;
}

/**
 * Trạng thái phủ nguồn — tách “chưa từng đồng bộ” khỏi “đã kiểm tra, không khớp”.
 * Không có state này thì panel luôn nói “chưa tìm thấy catalyst” kể cả khi
 * bảng catalyst_events còn rỗng vì chưa chạy sync lần nào.
 */
export type CatalystSourceState = "never_synced" | "sources_failed" | "synced";

export interface CatalystSyncInfo {
  state: CatalystSourceState;
  /** `finishedAt` mới nhất trong hợp các scope; null khi chưa từng sync. */
  lastSyncAt: string | null;
  /** Nguồn lỗi ở lần chạy gần nhất của chính nó (đã hợp qua các scope). */
  failedSources: string[];
  /** Nguồn thực sự đã chạy được — panel liệt kê danh sách này, không hardcode. */
  checkedSources: string[];
}

export interface CatalystSummary {
  symbol: string;
  facts: CatalystFact[];
  /** Câu tóm tắt facts-only; null khi không có fact nào khớp. */
  summary: string | null;
  mode: "llm" | "template" | "none";
  provider?: string;
  generatedAt: string;
  /** Lý do không có summary (để UI hiển thị trung thực). */
  note: string;
  /** Trạng thái đồng bộ nguồn tại thời điểm trả kết quả. */
  sync: CatalystSyncInfo;
}
