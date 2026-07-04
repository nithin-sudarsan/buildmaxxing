import { NextResponse } from "next/server";
import { extractFeedback } from "@/lib/fallback-agents";
import { callOpenRouterJson } from "@/lib/openrouter";
import type { FeedbackExtraction } from "@/lib/types";

export async function POST(request: Request) {
  const body = (await request.json()) as { rawReview?: string; cafeId?: string };
  const rawReview = body.rawReview?.trim() || "";
  const fallback = extractFeedback(rawReview);

  const llm = await callOpenRouterJson<FeedbackExtraction>([
    {
      role: "system",
      content:
        "Extract work-friendly cafe feedback into JSON only. Use wifiScore, plugScore, seatingScore as 1 to 5 when present. Use noiseLevel as quiet, moderate, busy, noisy, or noisy_after_lunch. Include summary and provider.",
    },
    {
      role: "user",
      content: JSON.stringify({
        cafeId: body.cafeId,
        rawReview,
        shape: fallback,
      }),
    },
  ]);

  if (llm?.summary) {
    return NextResponse.json({ ...llm, provider: "openrouter" });
  }

  return NextResponse.json(fallback);
}
