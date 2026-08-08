import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";

interface CorrelationMatrixData {
  narrativeId: number;
  narrativeName: string;
  coins: Array<{ coinId: number; symbol: string }>;
  matrix: number[][];
  avgCorrelation: number;
}

interface CorrelationHeatmapProps {
  data: CorrelationMatrixData | null;
  isLoading?: boolean;
}

function getCorrelationColor(correlation: number): string {
  if (correlation >= 0.7) return "bg-red-500/80 text-white";
  if (correlation >= 0.4) return "bg-yellow-500/80 text-white";
  if (correlation >= 0.2) return "bg-green-500/80 text-white";
  if (correlation > -0.2) return "bg-slate-700 text-slate-300";
  if (correlation > -0.5) return "bg-blue-500/80 text-white";
  return "bg-indigo-500/80 text-white";
}

function getCorrelationLabel(correlation: number): string {
  if (correlation >= 0.8) return "Very High";
  if (correlation >= 0.6) return "High";
  if (correlation >= 0.4) return "Moderate";
  if (correlation >= 0.2) return "Low";
  if (correlation >= -0.2) return "None";
  if (correlation >= -0.5) return "Negative";
  return "Strong Negative";
}

function getCorrelationDescription(correlation: number): string {
  if (correlation >= 0.8) return "Mối liên hệ rất cao, di chuyển đồng thuận";
  if (correlation >= 0.6) return "Mối liên hệ cao, di chuyển cùng chiều";
  if (correlation >= 0.4) return "Mối liên hệ trung bình, có xu hướng tương đồng";
  if (correlation >= 0.2) return "Mối liên hệ yếu, ảnh hưởng nhẹ";
  if (correlation >= -0.2) return "Không có mối liên hệ rõ ràng";
  if (correlation >= -0.5) return "Mối liên hệ nghịch chiều";
  return "Mối liên hệ nghịch chiều rất mạnh";
}

export function CorrelationHeatmap({ data, isLoading }: CorrelationHeatmapProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Correlation Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="py-8 text-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500 mx-auto" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.coins.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Correlation Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-slate-500 text-center py-8">
            No correlation data available. Need at least 2 coins with 5+ days of health history.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { coins, matrix, avgCorrelation, narrativeName } = data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Correlation Matrix {narrativeName ? `• ${narrativeName}` : ""}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {coins.length > 1 ? (
            <div className="flex items-center gap-4 text-xs text-slate-400">
              <span>Avg Correlation: <strong className="text-white">{avgCorrelation.toFixed(3)}</strong></span>
              <span>Risk: <strong className={avgCorrelation >= 0.6 ? "text-red-400" : "text-green-400"}>{getCorrelationLabel(avgCorrelation)}</strong></span>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Need at least 2 coins to calculate correlation</p>
          )}

          <div className="overflow-x-auto">
            <div className="inline-block min-w-full">
              <div className="flex items-center gap-1 mb-1 ml-20">
                {coins.map((coin) => (
                  <div key={coin.coinId} className="text-xs text-slate-400 text-center" style={{ width: 80 }}>
                    {coin.symbol}
                  </div>
                ))}
              </div>

              {coins.map((coin, i) => (
                <div key={coin.coinId} className="flex items-center gap-1 mb-1">
                  <div className="text-xs text-slate-400 text-right pr-2" style={{ width: 80 }}>
                    {coin.symbol}
                  </div>
                  {coins.map((otherCoin, j) => {
                    const correlation = matrix[i]?.[j] ?? 0;
                    return (
                      <div
                        key={otherCoin.coinId}
                        className={`flex items-center justify-center rounded text-xs font-mono ${getCorrelationColor(correlation)}`}
                        style={{ width: 80, height: 32 }}
                        title={`${coin.symbol} vs ${otherCoin.symbol}: ${correlation.toFixed(3)}\n${getCorrelationDescription(correlation)}`}
                      >
                        {correlation.toFixed(2)}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-slate-500 mt-4">
            <span>Legend:</span>
            <div className="flex items-center gap-1"><div className="w-4 h-4 bg-red-500/80 rounded" /> ≥0.7 High</div>
            <div className="flex items-center gap-1"><div className="w-4 h-4 bg-yellow-500/80 rounded" /> 0.4-0.7 Mod</div>
            <div className="flex items-center gap-1"><div className="w-4 h-4 bg-green-500/80 rounded" /> 0.2-0.4 Low</div>
            <div className="flex items-center gap-1"><div className="w-4 h-4 bg-slate-700 rounded" /> Near 0</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
