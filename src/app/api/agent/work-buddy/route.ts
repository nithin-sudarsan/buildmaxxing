import { NextResponse } from "next/server";
import { generateWorkPlan } from "@/lib/fallback-agents";
import { callOpenRouterJson } from "@/lib/openrouter";
import type { WorkBuddyResponse } from "@/lib/types";

type WorkBuddyCandidate = Partial<WorkBuddyResponse> & {
  shape?: Partial<WorkBuddyResponse>;
};

export async function POST(request: Request) {
  const body = (await request.json()) as {
    task?: string;
    duration?: string;
    cafeName?: string;
  };
  const task = body.task?.trim() || "finish the main task";
  const duration = body.duration?.trim() || "3 hours";
  const cafeName = body.cafeName?.trim() || "the selected cafe";
  const fallback = generateWorkPlan(task, duration, cafeName);

  const llm = await callOpenRouterJson<WorkBuddyCandidate>([
    {
      role: "system",
      content:
        'You are a work-session planner for someone working from a cafe. Plan the user task, not cafe operations. Use cafeName only as the setting. Return one top-level JSON object exactly like {"plan":[{"time":"0:00-0:30","task":"..."}],"provider":"openrouter"}. Include 4 to 6 focused steps that fit the duration from 0:00 onward. Do not wrap it in another key. Use regular hyphens in time ranges.',
    },
    {
      role: "user",
      content: JSON.stringify({ task, duration, cafeName }),
    },
  ]);

  const plan = llm?.plan ?? llm?.shape?.plan;
  if (plan?.length) {
    return NextResponse.json({ plan, provider: "openrouter" });
  }

  return NextResponse.json(fallback);
}
