// Chuyển nhà: bootstrap dùng chung nằm ở `src/lib/stats/bootstrap` (cùng Wilson
// và các thống kê khác). File này giữ đường import cũ cho backtest để việc gộp
// không phải sửa hàng loạt call-site.
export * from "@/lib/stats/bootstrap";
