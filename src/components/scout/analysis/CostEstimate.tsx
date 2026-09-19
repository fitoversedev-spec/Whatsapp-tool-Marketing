"use client";

export interface CostEstimateData {
  placeCount: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  estimatedCostInr: number;
}

export interface CostEstimateProps {
  estimate: CostEstimateData;
  className?: string;
}

export function CostEstimate({ estimate, className }: CostEstimateProps) {
  return (
    <div
      className={[
        "rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-[1.6]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <svg className="w-4 h-4 text-amber-600 flex-none" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
        <span className="font-semibold text-amber-800">AI Analysis Cost Estimate</span>
      </div>
      <div className="text-amber-700">
        <span className="font-semibold">{estimate.placeCount} places</span> will be analysed using
        Claude AI web search.
      </div>
      <div className="mt-1 text-amber-600 text-[12px]">
        Estimated cost: <span className="font-semibold">~₹{estimate.estimatedCostInr.toFixed(2)}</span>
        <span className="text-amber-500"> (~${estimate.estimatedCostUsd.toFixed(4)} USD)</span>
      </div>
    </div>
  );
}
