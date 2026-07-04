import { NextResponse } from "next/server";
import { buildWorkSessionPlan, recommendCafes } from "@/lib/fallback-agents";
import { distanceKm, normalizeUserLocation } from "@/lib/geo";
import { getExpandedCafes } from "@/lib/google-cafes";
import { callOpenRouterJson } from "@/lib/openrouter";
import type {
  Cafe,
  ConciergeResponse,
  Recommendation,
  UserLocation,
  WorkSessionPlan,
  WorkSessionStop,
} from "@/lib/types";

type ConciergeCandidate = Omit<Partial<ConciergeResponse>, "recommendations" | "sessionPlan"> & {
  recommendations?: Array<Partial<Recommendation> & { id?: string }>;
  followUpQuestions?: unknown;
  sessionPlan?: SessionPlanCandidate;
};

type ConciergeMode = "search" | "session_plan" | "rebook";
type SessionPlanCandidate = Partial<Omit<WorkSessionPlan, "stops">> & {
  stops?: Array<Partial<WorkSessionStop> & { cafe?: string }>;
};
type ConversationHistoryItem = {
  role: "user" | "assistant";
  content: string;
  followUpQuestion?: string;
};

function normalizeMatchScore(score?: number, fallbackScore = 75) {
  const numericScore = Number(score ?? fallbackScore);
  if (!Number.isFinite(numericScore)) return fallbackScore;
  return Math.max(35, Math.min(96, Math.round(numericScore)));
}

function normalizeReply(reply: unknown, fallbackReply: string) {
  if (typeof reply !== "string" || !reply.trim()) return fallbackReply;
  return reply.replaceAll("**", "").trim();
}

function normalizeFollowUps(followUps: unknown, fallbackFollowUps: string[]) {
  if (fallbackFollowUps.length === 0) return [];
  if (!Array.isArray(followUps)) return fallbackFollowUps;
  const normalized = followUps
    .map(String)
    .map((question) => question.replaceAll("**", "").trim())
    .filter(Boolean)
    .slice(0, 3);
  return normalized.length ? normalized : fallbackFollowUps;
}

function normalizeDistance(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : undefined;
}

function normalizeStringArray(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) return fallback;
  const normalized = value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 5);
  return normalized.length ? normalized : fallback;
}

function normalizeConversationHistory(value: unknown): ConversationHistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Partial<ConversationHistoryItem>;
      const role = candidate.role === "assistant" ? "assistant" : candidate.role === "user" ? "user" : null;
      const content = typeof candidate.content === "string" ? candidate.content.trim() : "";
      if (!role || !content) return null;
      const followUpQuestion = typeof candidate.followUpQuestion === "string"
        ? candidate.followUpQuestion.trim()
        : "";
      return {
        role,
        content,
        ...(followUpQuestion ? { followUpQuestion } : {}),
      };
    })
    .filter((item): item is ConversationHistoryItem => Boolean(item))
    .slice(-12);
}

function buildThreadAwareMessage(message: string, conversationHistory: ConversationHistoryItem[]) {
  const userTurns = conversationHistory
    .filter((item) => item.role === "user")
    .map((item) => item.followUpQuestion ? `${item.followUpQuestion}: ${item.content}` : item.content);
  const joined = userTurns.join(" ");
  return joined || message;
}

function normalizeSessionPlan(
  plan: ConciergeCandidate["sessionPlan"],
  fallbackPlan: WorkSessionPlan | undefined,
  cafePool: Cafe[],
): WorkSessionPlan | undefined {
  if (!plan?.stops?.length) return fallbackPlan;
  const cafeIds = new Set(cafePool.map((cafe) => cafe.id));
  const isMidSessionMove = plan.mode === "mid_session_move" || fallbackPlan?.mode === "mid_session_move";
  const normalizedStops = plan.stops
    .map((stop, index) => {
      const cafeId = stop.cafeId ?? stop.cafe;
      if (!cafeId || !cafeIds.has(cafeId)) return null;
      const cafe = cafePool.find((item) => item.id === cafeId);
      const titleCandidate = String(stop.title ?? (index === 0 ? "Work base" : "Next block")).trim();
      let title = titleCandidate;
      if (isMidSessionMove && index === 0) {
        title = "Next spot";
      } else if (cafe && titleCandidate.toLowerCase() === cafe.name.toLowerCase()) {
        title = index === 0 ? "Deep work base" : "Call and wrap spot";
      }
      const walk = index > 0 ? normalizeDistance(stop.walkFromPreviousMin) : undefined;
      return {
        id: String(stop.id ?? `stop-${index + 1}`),
        cafeId,
        title,
        start: String(stop.start ?? (index === 0 ? "Start" : "Later")),
        end: String(stop.end ?? "Finish"),
        purpose: String(stop.purpose ?? "Use this stop for the next focused work block."),
        rationale: String(stop.rationale ?? "Chosen from the supplied cafe data."),
        needs: normalizeStringArray(stop.needs, fallbackPlan?.stops[index]?.needs ?? []),
        ...(walk !== undefined ? { walkFromPreviousMin: Math.max(1, Math.round(walk)) } : {}),
        ...(typeof stop.caution === "string" && stop.caution.trim() ? { caution: stop.caution.trim() } : {}),
      };
    })
    .filter((stop): stop is WorkSessionPlan["stops"][number] => Boolean(stop))
    .slice(0, isMidSessionMove ? 1 : 3);

  if (!normalizedStops.length) return fallbackPlan;

  return {
    mode: isMidSessionMove ? "mid_session_move" : fallbackPlan?.mode ?? "session_plan",
    headline: typeof plan.headline === "string" && plan.headline.trim()
      ? plan.headline.trim()
      : fallbackPlan?.headline ?? "Work session plan",
    summary: typeof plan.summary === "string" && plan.summary.trim()
      ? plan.summary.trim()
      : fallbackPlan?.summary ?? "Built from cafe work signals, distance, and your request.",
    ...(typeof plan.totalDuration === "string" && plan.totalDuration.trim()
      ? { totalDuration: plan.totalDuration.trim() }
      : fallbackPlan?.totalDuration
        ? { totalDuration: fallbackPlan.totalDuration }
        : {}),
    ...(typeof plan.startTime === "string" && plan.startTime.trim()
      ? { startTime: plan.startTime.trim() }
      : fallbackPlan?.startTime
        ? { startTime: fallbackPlan.startTime }
        : {}),
    ...(typeof plan.endTime === "string" && plan.endTime.trim()
      ? { endTime: plan.endTime.trim() }
      : fallbackPlan?.endTime
        ? { endTime: fallbackPlan.endTime }
        : {}),
    stops: normalizedStops,
    ...(typeof plan.nextAction === "string" && plan.nextAction.trim()
      ? { nextAction: plan.nextAction.trim() }
      : fallbackPlan?.nextAction
        ? { nextAction: fallbackPlan.nextAction }
        : {}),
    ...(typeof plan.contingency === "string" && plan.contingency.trim()
      ? { contingency: plan.contingency.trim() }
      : fallbackPlan?.contingency
        ? { contingency: fallbackPlan.contingency }
        : {}),
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    message?: string;
    followUpQuestion?: string | null;
    conversationHistory?: unknown;
    location?: UserLocation;
    currentCafeId?: string;
    mode?: ConciergeMode;
    activeSessionPlan?: WorkSessionPlan | null;
  };
  const message = body.message?.trim() || "Find me a good place to work.";
  const followUpQuestion = typeof body.followUpQuestion === "string" ? body.followUpQuestion.trim() : "";
  const conversationHistory = normalizeConversationHistory(body.conversationHistory);
  const threadAwareMessage = buildThreadAwareMessage(message, conversationHistory);
  const userLocation = normalizeUserLocation(body.location);
  const cafes = await getExpandedCafes();
  const currentCafe = cafes.find((cafe) => cafe.id === body.currentCafeId);
  const effectiveLocation = userLocation ?? (currentCafe ? { lat: currentCafe.lat, lng: currentCafe.lng } : undefined);
  const recommendationPool = body.mode === "rebook" && currentCafe
    ? cafes.filter((cafe) => cafe.id !== currentCafe.id)
    : cafes;
  const fallback = recommendCafes(threadAwareMessage, effectiveLocation, recommendationPool, 3, currentCafe);
  const rankedRecommendations = recommendCafes(threadAwareMessage, effectiveLocation, recommendationPool, 70, currentCafe).recommendations;
  const fallbackSessionPlan =
    fallback.sessionPlan ??
    buildWorkSessionPlan(threadAwareMessage, fallback.recommendations, recommendationPool, effectiveLocation, currentCafe);
  const nearbyRecommendations = effectiveLocation
    ? rankedRecommendations.filter((recommendation) => {
        return recommendation.distanceKm === undefined || recommendation.distanceKm <= 4;
      })
    : rankedRecommendations;
  const candidateRecommendations = (nearbyRecommendations.length >= 12 ? nearbyRecommendations : rankedRecommendations)
    .slice(0, 45);
  const candidateCafes = candidateRecommendations.flatMap((recommendation) => {
    const cafe = recommendationPool.find((item) => item.id === recommendation.cafeId);
    return cafe ? [cafe] : [];
  });

  const llm = await callOpenRouterJson<ConciergeCandidate>([
    {
      role: "system",
      content:
        [
          "You are BuildMaxxing, a conversational London workcafe concierge.",
          "Your job is to plan work sessions across the city, not merely rank search results.",
          "Return JSON only with intent, reply, followUpQuestions, recommendations, sessionPlan when useful, and provider.",
          "Use conversationHistory as the ongoing thread. Treat the latest message as a continuation, not a brand-new search, unless the user clearly changes topic.",
          "When the user answers a follow-up question, merge that answer with the earlier request and update the plan instead of asking from scratch.",
          "Pick exactly 3 cafe ids from the supplied dataset. Do not invent cafes.",
          "Use the user's task, time window, call times, remaining work, plug risk, WiFi, quiet, proximity, walking time, and open-now status when available.",
          "If the user asks to plan a work session, return sessionPlan with one or two cafe stops. Split the session only when it genuinely helps.",
          "If the user asks for a next spot mid-session, return sessionPlan.mode mid_session_move and do not suggest the current cafe unless there is no alternative.",
          "If the user has not provided enough context, still make an initial plan, state the assumption, and ask 1-3 high-level follow-up questions.",
          "The reply should be warm, concise, and specific. Mention why the first move fits, caveats such as closed/unknown hours, and what would improve the next answer.",
          "Do not sound like a search engine. Do not only list cafe names.",
          "If userLocation or currentCafe is present, strongly prefer strong work matches nearby unless the prompt names a specific area.",
        ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({
        message,
        followUpQuestion: followUpQuestion || undefined,
        conversationHistory,
        mode: body.mode ?? "session_plan",
        userLocation: effectiveLocation,
        currentCafe: currentCafe
          ? {
              id: currentCafe.id,
              name: currentCafe.name,
              area: currentCafe.area,
              wifiScore: currentCafe.wifiScore,
              plugScore: currentCafe.plugScore,
              seatingScore: currentCafe.seatingScore,
              noiseLevel: currentCafe.noiseLevel,
              callFriendly: currentCafe.callFriendly,
            }
          : undefined,
        activeSessionPlan: body.activeSessionPlan,
        cafes: candidateCafes.map((cafe) => ({
          id: cafe.id,
          name: cafe.name,
          area: cafe.area,
          distanceKm: effectiveLocation ? Number(distanceKm(effectiveLocation, cafe).toFixed(2)) : undefined,
          openNow: cafe.openNow,
          wifiScore: cafe.wifiScore,
          plugScore: cafe.plugScore,
          seatingScore: cafe.seatingScore,
          noiseLevel: cafe.noiseLevel,
          laptopFriendly: cafe.laptopFriendly,
          callFriendly: cafe.callFriendly,
          recommendedStay: cafe.recommendedStay,
          bestFor: cafe.bestFor,
          workSummary: cafe.workSummary,
        })),
        requiredShape: {
          intent: fallback.intent,
          reply: "2-4 sentence conversational answer with assumptions and caveats",
          followUpQuestions: ["0-3 short questions only if context is missing"],
          recommendations: [
            {
              cafeId: "one supplied cafe id",
              rank: 1,
              reason: "specific fit: task, wifi/plugs/noise, proximity, and opening-status caveat if relevant",
              matchScore: "35-96 number, never 100",
              distanceKm: "number when userLocation is present",
            },
          ],
          sessionPlan: {
            mode: "session_plan or mid_session_move",
            headline: "short decision headline",
            summary: "why this plan works",
            totalDuration: "duration if known",
            stops: [
              {
                id: "stable stop id",
                cafeId: "one supplied cafe id",
                title: "Deep work base, Call spot, or Next spot",
                start: "Start, Now, 2 PM, etc",
                end: "Before 4 PM, Finish, etc",
                purpose: "what the user should do here",
                rationale: "specific WiFi, plugs, quiet, busyness, call, or location reasoning",
                needs: ["quiet", "calls", "plugs"],
                walkFromPreviousMin: "integer for second stop if estimating a move",
                caution: "optional caveat",
              },
            ],
            nextAction: "concrete next move",
            contingency: "what to do if cafe conditions change",
          },
          provider: "openrouter",
        },
      }),
    },
  ]);

  if (llm?.recommendations?.length) {
    const cafeIds = new Set(recommendationPool.map((cafe) => cafe.id));
    const normalizedRecommendations = llm.recommendations
      .map<Recommendation | null>((recommendation) => {
        const cafeId = recommendation.cafeId ?? recommendation.id;
        if (!cafeId || !cafeIds.has(cafeId)) return null;
        const cafe = recommendationPool.find((item) => item.id === cafeId);
        const fallbackRecommendation = fallback.recommendations.find((item) => item.cafeId === cafeId);
        const resolvedDistance = effectiveLocation && cafe
          ? Number(distanceKm(effectiveLocation, cafe).toFixed(2))
          : normalizeDistance(recommendation.distanceKm ?? fallbackRecommendation?.distanceKm);
        return {
          cafeId,
          rank: 0,
          reason: recommendation.reason ?? fallbackRecommendation?.reason ?? "Strong fit for this request.",
          matchScore: normalizeMatchScore(recommendation.matchScore, fallbackRecommendation?.matchScore),
          ...(resolvedDistance !== undefined ? { distanceKm: resolvedDistance } : {}),
        };
      })
      .filter((recommendation): recommendation is Recommendation => Boolean(recommendation))
      .slice(0, 3);

    const recommendedIds = new Set(normalizedRecommendations.map((recommendation) => recommendation.cafeId));
    const filledRecommendations = [
      ...normalizedRecommendations,
      ...fallback.recommendations.filter((recommendation) => !recommendedIds.has(recommendation.cafeId)),
    ]
      .slice(0, 3)
      .map((recommendation, index) => ({ ...recommendation, rank: index + 1 }));

    if (filledRecommendations.length) {
      const sessionPlan = normalizeSessionPlan(llm.sessionPlan, fallbackSessionPlan, recommendationPool);
      return NextResponse.json({
        intent: {
          area: llm.intent?.area ?? fallback.intent.area,
          duration: llm.intent?.duration ?? fallback.intent.duration,
          task: llm.intent?.task ?? fallback.intent.task,
          needs: Array.isArray(llm.intent?.needs) && llm.intent.needs.length > 0
            ? llm.intent.needs
            : fallback.intent.needs,
        },
        reply: normalizeReply(llm.reply, fallback.reply),
        followUpQuestions: normalizeFollowUps(llm.followUpQuestions, fallback.followUpQuestions),
        recommendations: filledRecommendations,
        ...(sessionPlan ? { sessionPlan } : {}),
        provider: "openrouter",
      });
    }
  }

  return NextResponse.json(fallback);
}
