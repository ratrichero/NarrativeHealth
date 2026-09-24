// SQ-UX: translate raw pipeline/publication errors into plain Vietnamese
// explanations for the Square Analytics dashboard.
//
// Why: pipeline error strings are raw driver output ("Failed query: insert
// into "square_fingerprints" ... duplicate key value violates unique
// constraint ...") which operators cannot act on. The dashboard shows the
// human summary; the full technical text stays available via tooltip/logs.
//
// Public API:
//   explainPipelineError(raw)   → { summary, action } | null
//   describeFailureCategory(c)  → Vietnamese category label | null

export interface ErrorExplanation {
  /** One-sentence "what happened" in plain Vietnamese. */
  summary: string;
  /** What to do about it (or why it is harmless), also Vietnamese. */
  action: string;
}

// Known Binance error codes → meaning + suggested action. Mirrors the
// RETRYABLE/PERMANENT sets in publisher.ts.
const BINANCE_CODE_EXPLANATIONS: Record<string, ErrorExplanation> = {
  "220003": {
    summary: "Khóa API Binance Square không tồn tại hoặc không hợp lệ.",
    action: "Cập nhật BINANCE_SQUARE_OPENAPI_KEY trong cấu hình rồi thử lại.",
  },
  "220004": {
    summary: "Khóa API Binance Square đã hết hạn.",
    action: "Tạo khóa API mới trên Binance và cập nhật vào cấu hình.",
  },
  "220009": {
    summary: "Đã vượt giới hạn số bài đăng trên Binance Square trong ngày.",
    action: "Chờ sang ngày hôm nay kế tiếp — hệ thống sẽ tự tiếp tục đăng.",
  },
  "220014": {
    summary: "Đã vượt giới hạn tải ảnh lên Binance trong ngày.",
    action: "Chờ sang ngày kế tiếp — hạn mức được reset mỗi ngày.",
  },
  "20002": {
    summary: "Binance từ chối bài viết vì phát hiện từ ngữ nhạy cảm.",
    action: "Xem bài trong lịch sử đăng để tìm từ bị chặn và bổ sung vào bộ lọc của pipeline.",
  },
  "20022": {
    summary: "Binance từ chối bài viết vì phát hiện từ ngữ nhạy cảm.",
    action: "Xem bài trong lịch sử đăng để tìm từ bị chặn và bổ sung vào bộ lọc của pipeline.",
  },
  "20013": {
    summary: "Bài viết vượt giới hạn độ dài cho phép của Binance.",
    action: "Rút gọn nội dung — kiểm tra giới hạn ký tự trong cấu hình sinh nội dung.",
  },
  "20020": {
    summary: "Binance từ chối vì nội dung bài đăng trống.",
    action: "Kiểm tra bước sinh nội dung — có thể LLM trả về kết quả rỗng và template không thay thế được.",
  },
  "220011": {
    summary: "Binance từ chối vì nội dung bài đăng trống.",
    action: "Kiểm tra bước sinh nội dung — có thể LLM trả về kết quả rỗng và template không thay thế được.",
  },
  "30008": {
    summary: "Tài khoản Binance đang bị hạn chế đăng bài (tạm thời).",
    action: "Hệ thống sẽ tự động thử lại sau — không cần can thiệp.",
  },
  "2000001": {
    summary: "Thiết bị đăng bài bị Binance tạm thời hạn chế.",
    action: "Hệ thống sẽ tự động thử lại sau — không cần can thiệp.",
  },
  "2000002": {
    summary: "Tài khoản Binance bị hạn chế (vĩnh viễn theo cấu hình hiện tại).",
    action: "Kiểm tra trạng thái tài khoản đăng bài trên Binance.",
  },
  QUOTA_EXCEEDED: {
    summary: "Hết hạn ngạch đăng bài trong ngày theo cấu hình pipeline.",
    action: "Chờ sang ngày kế tiếp hoặc tăng daily cap trong cấu hình pipeline.",
  },
  ALREADY_PUBLISHED: {
    summary: "Cơ hội này đã được đăng bài trước đó rồi.",
    action: "Bỏ qua bình thường — đây là cơ chế chống trùng bài hoạt động đúng.",
  },
};

// Pattern-driven explanations, checked in order. First match wins.
const ERROR_PATTERNS: { pattern: RegExp; explain: (m: RegExpMatchArray) => ErrorExplanation }[] = [
  {
    // SQ-DIAG root cause: the fingerprint UNIQUE slot is TTL-based, so an
    // expired dedup row still occupies the slot when the same thesis recurs.
    // With onConflictDoNothing in place this should no longer appear at all.
    pattern: /insert into "square_fingerprints"[\s\S]*duplicate key/i,
    explain: () => ({
      summary:
        "Xung đột 'dấu vân tay' chống trùng lặp: bài đăng thành công nhưng không ghi được dấu vân tay vào database vì một bài cũ (đã hết hạn) vẫn chiếm chỗ.",
      action:
        "Không ảnh hưởng việc chống trùng bài — đã được sửa trong code hiện tại (bỏ qua xung đột thay vì báo lỗi). Nếu vẫn thấy lỗi này, kiểm tra lại phiên bản code đang chạy.",
    }),
  },
  {
    pattern: /duplicate key[\s\S]*"square_publications[^"]*"/i,
    explain: () => ({
      summary:
        "Bản ghi đăng bài bị trùng trong database (thường xảy ra khi hệ thống thử lại bài đăng cũ).",
      action: "Thường vô hại khi do retry. Nếu lặp lại liên tục, kiểm tra ràng buộc UNIQUE của bảng square_publications.",
    }),
  },
  {
    pattern: /duplicate key/i,
    explain: () => ({
      summary:
        "Dữ liệu bị trùng: bản ghi này đã tồn tại trong database nên không chèn thêm được.",
      action: "Thường vô hại khi do pipeline chạy lại. Nếu lặp lại, kiểm tra ràng buộc UNIQUE trong schema.",
    }),
  },
  {
    pattern: /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up|fetch failed)\b/i,
    explain: () => ({
      summary:
        "Không kết nối được server/API (mạng chập chờn hoặc server tạm thời quá tải).",
      action: "Hệ thống sẽ tự thử lại. Nếu lỗi lặp lại nhiều lần, kiểm tra kết nối mạng và trạng thái của API.",
    }),
  },
  {
    pattern: /\b(429|rate limit|too many requests)\b/i,
    explain: () => ({
      summary:
        "Bị giới hạn tốc độ: gửi yêu cầu quá dày trong một khoảng thời gian ngắn.",
      action: "Hệ thống tự động chờ theo hướng dẫn của API rồi thử lại — không cần can thiệp.",
    }),
  },
  {
    pattern: /\b(timeout|AbortError|operation was aborted)\b/i,
    explain: () => ({
      summary: "API không phản hồi kịp trong thời gian chờ cho phép (timeout).",
      action: "Hệ thống sẽ tự thử lại. Nếu xảy ra thường xuyên với cùng một nhà cung cấp, cân nhắc tăng thời gian chờ.",
    }),
  },
  {
    pattern: /Failed query/i,
    explain: () => ({
      summary: "Lỗi truy vấn database: một câu lệnh ghi/đọc dữ liệu không thực hiện được.",
      action: "Xem câu lệnh lỗi đầy đủ ở phần chú thích (tooltip) hoặc log để biết chi tiết kỹ thuật.",
    }),
  },
  {
    pattern: /(No LLM provider|OPENAI_API_KEY|provider configured)/i,
    explain: () => ({
      summary: "Chưa cấu hình khóa LLM nên bài viết dùng template có sẵn thay vì AI.",
      action: "Bổ sung OPENAI_API_KEY (và các khóa fallback nếu có) vào cấu hình môi trường.",
    }),
  },
  {
    pattern: /(failed validation|repair)/i,
    explain: () => ({
      summary: "Bài viết do AI tạo ra không đạt chuẩn kiểm định (thiếu cashtag, sai định dạng hoặc dùng từ cấm).",
      action: "Hệ thống đã tự yêu cầu AI sửa lại hoặc chuyển sang template dự phòng — bài vẫn được đăng.",
    }),
  },
];

/**
 * Translate a raw pipeline/publication error string into a plain-Vietnamese
 * explanation. Returns null when there is nothing to explain. The "Content
 * generation failed for opportunity N:" label is stripped first — it is a
 * step label, not the error itself.
 */
export function explainPipelineError(
  raw: string | null | undefined
): ErrorExplanation | null {
  if (!raw) return null;

  const text = raw
    .replace(/Content generation failed for opportunity \d+:\s*/gi, "")
    .trim();
  if (!text) return null;

  // 1. Known Binance API codes (most specific — exact token match).
  for (const [code, explanation] of Object.entries(BINANCE_CODE_EXPLANATIONS)) {
    if (text.includes(code)) return explanation;
  }

  // 2. Pattern-based explanations.
  for (const { pattern, explain } of ERROR_PATTERNS) {
    const m = text.match(pattern);
    if (m) return explain(m);
  }

  // 3. Fallback — never translate what we cannot classify.
  return {
    summary: "Đã xảy ra lỗi chưa được phân loại trong pipeline đăng bài.",
    action: "Xem nội dung kỹ thuật đầy đủ ở phần chú thích (tooltip) hoặc log để điều tra thêm.",
  };
}

/** Vietnamese label for the publication failureCategory column. */
export function describeFailureCategory(
  category: string | null | undefined
): string | null {
  switch (category) {
    case "PERMANENT":
      return "Lỗi vĩnh viễn — không thể thử lại";
    case "TRANSIENT":
      return "Lỗi tạm thời — sẽ tự thử lại";
    case "TIMEOUT":
      return "Hết thời gian chờ — sẽ tự thử lại";
    case "UNKNOWN":
      return "Lỗi không rõ nguyên nhân";
    default:
      return category ? null : null;
  }
}
