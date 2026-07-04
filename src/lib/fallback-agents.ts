import { cafes } from "./cafes";
import { distanceKm } from "./geo";
import { calculateWorkScore } from "./scoring";
import type {
  Cafe,
  ConciergeResponse,
  FeedbackExtraction,
  Intent,
  Recommendation,
  UserLocation,
  WorkBuddyResponse,
  WorkPlanItem,
  WorkSessionPlan,
  WorkSessionStop,
} from "./types";

const areaAliases: Record<string, string[]> = {
  Shoreditch: ["shoreditch", "old street", "hoxton", "ec2a"],
  "Liverpool Street": ["liverpool street", "bishopsgate", "spitalfields", "ec2m"],
  "King's Cross": ["king's cross", "kings cross", "st pancras", "n1c"],
  Soho: ["soho", "oxford circus", "tottenham court road", "w1"],
  "South Bank": ["south bank", "waterloo", "se1"],
  Waterloo: ["waterloo", "lower marsh"],
  Clerkenwell: ["clerkenwell", "farringdon", "ec1"],
  Farringdon: ["farringdon", "smithfield"],
  Bank: ["bank", "monument", "threadneedle"],
  Hackney: ["hackney", "mare street", "e8"],
  Brixton: ["brixton", "sw9"],
  Camden: ["camden", "nw1"],
  Greenwich: ["greenwich", "se10"],
  Victoria: ["victoria", "sw1"],
  "Canary Wharf": ["canary wharf", "docklands", "e14"],
  "Notting Hill": ["notting hill", "portobello", "w11"],
  "London Bridge": ["london bridge", "borough", "se1"],
  Marylebone: ["marylebone", "baker street", "w1u"],
  Mayfair: ["mayfair", "bond street", "w1k"],
  Kensington: ["kensington", "high street kensington", "w8"],
  Islington: ["islington", "angel", "upper street", "n1"],
  Dalston: ["dalston", "kingsland", "e8"],
};

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

export function inferIntent(message: string): Intent {
  const text = message.toLowerCase();
  const area = Object.entries(areaAliases).find(([, aliases]) =>
    includesAny(text, aliases),
  )?.[0];
  const task = inferTask(text);

  const needs = new Set<string>();
  if (includesAny(text, ["wifi", "wi-fi", "internet", "connection"])) {
    needs.add("wifi");
  }
  if (includesAny(text, ["plug", "socket", "charger", "outlet", "power"])) {
    needs.add("plugs");
  }
  if (includesAny(text, ["quiet", "calm", "focus", "deep work"])) {
    needs.add("quiet");
  }
  if (includesAny(text, ["call", "zoom", "meeting", "phone"])) {
    needs.add("calls");
  }
  if (includesAny(text, ["seat", "table", "space", "long session"])) {
    needs.add("seating");
  }
  if (includesAny(text, ["train", "station", "before my train"])) {
    needs.add("near transport");
  }
  if (includesAny(text, ["open now", "right now", "currently open", "today", "tonight", "this evening"])) {
    needs.add("open now");
  }
  if (task === "coding" || task === "application writing" || task === "study") {
    needs.add("wifi");
    needs.add("plugs");
    needs.add("quiet");
  }
  if (task === "calls") {
    needs.add("calls");
    needs.add("quiet");
  }
  if (task === "quick admin") {
    needs.add("wifi");
  }

  const durationMatch = text.match(/(\d+(?:\.\d+)?)\s*(hour|hr|h|minute|min)/);
  const duration = durationMatch
    ? `${durationMatch[1]} ${durationMatch[2].startsWith("h") ? "hours" : "minutes"}`
    : undefined;

  if (needs.size === 0) {
    needs.add("balanced work session");
  }

  return {
    area,
    duration,
    task,
    needs: Array.from(needs),
  };
}

function inferTask(text: string) {
  if (includesAny(text, ["yc application", "application", "cover letter", "personal statement", "resume", "cv"])) {
    return "application writing";
  }
  if (includesAny(text, ["code", "coding", "program", "debug", "build", "ship", "develop"])) {
    return "coding";
  }
  if (includesAny(text, ["zoom", "call", "meeting", "interview", "phone"])) {
    return "calls";
  }
  if (includesAny(text, ["write", "writing", "essay", "draft", "proposal", "doc", "docs"])) {
    return "writing";
  }
  if (includesAny(text, ["study", "revise", "revision", "read", "reading", "research"])) {
    return "study";
  }
  if (includesAny(text, ["email", "admin", "inbox", "quick task"])) {
    return "quick admin";
  }
  if (includesAny(text, ["design", "figma", "mockup", "deck", "slides"])) {
    return "design";
  }
  return undefined;
}

function proximityBoost(distance?: number) {
  if (distance === undefined) return 0;
  if (distance <= 0.5) return 30;
  if (distance <= 1) return 24;
  if (distance <= 1.5) return 18;
  if (distance <= 2.5) return 10;
  if (distance <= 4) return 4;
  if (distance >= 10) return -12;
  return 0;
}

function toMatchScore(score: number) {
  return Math.max(35, Math.min(96, Math.round(62 + (score - 60) * 0.45)));
}

function cafeDistanceKm(a: Pick<Cafe, "lat" | "lng">, b: Pick<Cafe, "lat" | "lng">) {
  return distanceKm({ lat: a.lat, lng: a.lng }, b);
}

function walkingMinutes(km: number) {
  return Math.max(3, Math.round((km / 4.8) * 60));
}

function matchCafe(cafe: Cafe, intent: Intent, userLocation?: UserLocation) {
  let score = calculateWorkScore(cafe);
  const reasons: string[] = [];
  const cafeDistance = userLocation ? distanceKm(userLocation, cafe) : undefined;

  if (intent.area && cafe.area === intent.area) {
    score += 24;
    reasons.push(`${cafe.area} area`);
  } else if (
    intent.area &&
    cafe.bestFor.join(" ").toLowerCase().includes(intent.area.toLowerCase())
  ) {
    score += 8;
  }

  for (const need of intent.needs) {
    if (need === "wifi") {
      score += cafe.wifiScore >= 4 ? 12 : -6;
      if (cafe.wifiScore >= 4) reasons.push("strong WiFi");
    }
    if (need === "plugs") {
      score += cafe.plugScore >= 4 ? 12 : -8;
      if (cafe.plugScore >= 4) reasons.push("good socket access");
    }
    if (need === "quiet") {
      score += cafe.noiseLevel === "quiet" ? 16 : cafe.noiseLevel === "moderate" ? 6 : -10;
      if (cafe.noiseLevel === "quiet") reasons.push("quiet room");
    }
    if (need === "calls") {
      score += cafe.callFriendly ? 14 : -8;
      if (cafe.callFriendly) reasons.push("call-friendly");
    }
    if (need === "seating") {
      score += cafe.seatingScore >= 4 ? 10 : -4;
      if (cafe.seatingScore >= 4) reasons.push("reliable seating");
    }
    if (need === "open now") {
      if (cafe.openNow === true) {
        score += 8;
        reasons.push("listed open now");
      } else if (cafe.openNow === false) {
        score -= 30;
        reasons.push("listed closed right now");
      } else {
        score -= 4;
        reasons.push("hours need checking");
      }
    }
  }

  if (intent.task === "application writing" || intent.task === "writing") {
    score += cafe.noiseLevel === "quiet" ? 8 : cafe.noiseLevel === "moderate" ? 3 : -8;
    if (cafe.noiseLevel === "quiet") reasons.push("good for writing focus");
  }

  if (intent.task === "coding") {
    score += cafe.wifiScore >= 4 && cafe.plugScore >= 4 ? 8 : -4;
    if (cafe.wifiScore >= 4 && cafe.plugScore >= 4) reasons.push("coding-friendly WiFi and plugs");
  }

  if (intent.task === "calls") {
    score += cafe.callFriendly ? 10 : -12;
  }

  if (intent.duration?.includes("3") && cafe.recommendedStay.includes("3")) {
    score += 8;
    reasons.push("fits a 3-hour stay");
  }

  const distanceBoost = proximityBoost(cafeDistance);
  score += distanceBoost;
  if (cafeDistance !== undefined) {
    if (cafeDistance <= 1) {
      reasons.unshift(`${cafeDistance.toFixed(1)} km from you`);
    } else if (distanceBoost > 0) {
      reasons.push(`${cafeDistance.toFixed(1)} km away`);
    }
  }

  return {
    score,
    distanceKm: cafeDistance === undefined ? undefined : Number(cafeDistance.toFixed(2)),
    reason:
      reasons.length > 0
        ? `Strong fit: ${reasons.slice(0, 3).join(", ")}. ${cafe.workSummary}`
        : cafe.workSummary,
  };
}

function buildFollowUpQuestions(message: string, intent: Intent, userLocation?: UserLocation) {
  const text = message.toLowerCase();
  const questions: string[] = [];

  if (!intent.task) {
    questions.push("What are you working on: deep work, calls, writing, or quick admin?");
  }
  if (!intent.duration) {
    questions.push("How long do you want to stay?");
  }
  if (!intent.area && !userLocation) {
    questions.push("Should I keep this near you or in a specific London area?");
  }
  if (!includesAny(text, ["plug", "socket", "charger", "outlet", "power", "wifi", "wi-fi", "quiet", "call", "zoom"])) {
    questions.push("Do you care most about plugs, quiet, calls, or reliable WiFi?");
  }
  if (!intent.needs.includes("open now")) {
    questions.push("Do you need somewhere open right now?");
  }

  return questions.slice(0, 3);
}

function parseClockTimes(message: string) {
  const matches = Array.from(message.matchAll(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi));
  return matches
    .map((match) => {
      const hour = Number(match[1]);
      const minute = match[2] ? `:${match[2]}` : "";
      const suffix = match[3].toUpperCase();
      if (!Number.isFinite(hour)) return null;
      return `${hour}${minute} ${suffix}`;
    })
    .filter((time): time is string => Boolean(time));
}

function parseDurationLabel(message: string, intent: Intent) {
  return intent.duration ?? message.match(/(\d+(?:\.\d+)?)\s*(hour|hr|h)s?/i)?.[0] ?? undefined;
}

function isMidSessionMove(message: string) {
  const text = message.toLowerCase();
  return includesAny(text, [
    "next spot",
    "rebook",
    "move me",
    "move somewhere",
    "getting loud",
    "too loud",
    "no plug",
    "no socket",
    "battery",
    "20%",
    "laptop is at",
  ]);
}

function wantsSessionPlan(message: string, intent: Intent) {
  const text = message.toLowerCase();
  return (
    isMidSessionMove(message) ||
    includesAny(text, ["plan", "session", "deep work", "this afternoon", "this morning", "today", "call at"]) ||
    Boolean(intent.duration && (intent.task || intent.needs.includes("calls") || intent.needs.includes("quiet")))
  );
}

function cafeByRecommendation(recommendation: Recommendation, cafePool: Cafe[]) {
  return cafePool.find((cafe) => cafe.id === recommendation.cafeId);
}

function bestAlternativeCafe(
  recommendations: Recommendation[],
  cafePool: Cafe[],
  currentCafe?: Cafe,
) {
  return recommendations
    .map((recommendation) => cafeByRecommendation(recommendation, cafePool))
    .find((cafe): cafe is Cafe => Boolean(cafe && cafe.id !== currentCafe?.id));
}

export function buildWorkSessionPlan(
  message: string,
  recommendations: Recommendation[],
  cafePool: Cafe[],
  userLocation?: UserLocation,
  currentCafe?: Cafe,
): WorkSessionPlan | undefined {
  const intent = inferIntent(message);
  if (!wantsSessionPlan(message, intent)) return undefined;

  const moveMode = isMidSessionMove(message);
  const callTimes = parseClockTimes(message);
  const totalDuration = parseDurationLabel(message, intent);
  const firstCafe =
    (moveMode ? bestAlternativeCafe(recommendations, cafePool, currentCafe) : undefined) ??
    cafeByRecommendation(recommendations[0], cafePool);
  if (!firstCafe) return undefined;

  const secondCafe = bestAlternativeCafe(
    recommendations.filter((recommendation) => recommendation.cafeId !== firstCafe.id),
    cafePool,
    firstCafe,
  );
  const shouldSplit =
    Boolean(secondCafe) &&
    !moveMode &&
    (callTimes.length >= 2 || totalDuration?.startsWith("4") || totalDuration?.startsWith("5"));
  const firstPurpose = moveMode
    ? "Recover the remaining work block with a better fit."
    : callTimes.length
      ? "Anchor the focused work before and between calls."
      : "Use this as the stable base for the main work block.";

  const stops: WorkSessionStop[] = [
    {
      id: moveMode ? "next-spot" : "base",
      cafeId: firstCafe.id,
      title: moveMode ? "Next spot" : shouldSplit ? "Deep work base" : "Work base",
      start: moveMode ? "Next" : "Start",
      end: shouldSplit && callTimes[0] ? `Before ${callTimes[0]}` : totalDuration ?? "Finish",
      purpose: firstPurpose,
      rationale: `${firstCafe.name} gives you ${firstCafe.wifiScore}/5 WiFi, ${firstCafe.plugScore}/5 plugs, and a ${firstCafe.noiseLevel} room profile.`,
      needs: Array.from(new Set([...intent.needs, firstCafe.callFriendly ? "calls possible" : "headphones useful"])).slice(0, 4),
      caution: firstCafe.openNow === false ? "Maps currently marks this cafe closed. Check before moving." : undefined,
    },
  ];

  if (shouldSplit && secondCafe) {
    const walkMin = walkingMinutes(cafeDistanceKm(firstCafe, secondCafe));
    stops.push({
      id: "second-block",
      cafeId: secondCafe.id,
      title: callTimes.length ? "Call and wrap spot" : "Change-of-scene block",
      start: callTimes[0] ? `After ${callTimes[0]}` : "Mid-session",
      end: callTimes[1] ? `Through ${callTimes[1]}` : "Finish",
      purpose: callTimes.length
        ? "Move only if the first room gets noisy or you need a fresher call setup."
        : "Use the move as a reset if the first table stops working.",
      rationale: `${secondCafe.name} is the backup with ${secondCafe.plugScore}/5 plug odds and ${secondCafe.seatingScore}/5 seating.`,
      needs: ["backup table", secondCafe.callFriendly ? "calls possible" : "short calls only", "walking reset"],
      walkFromPreviousMin: walkMin,
      caution: walkMin > 18 ? "This is a longer move, so only split if the session needs a reset." : undefined,
    });
  }

  const headline = moveMode
    ? `Move to ${firstCafe.name} for the next block`
    : shouldSplit
      ? "A two-stop work route for this session"
      : `${firstCafe.name} as your session base`;
  const summary = moveMode
    ? "I treated noise, plug risk, remaining work, and walking distance as the decision variables."
    : "I treated call times, quiet, WiFi, plugs, busyness, and walking time as the decision variables.";

  return {
    mode: moveMode ? "mid_session_move" : "session_plan",
    headline,
    summary,
    totalDuration,
    startTime: moveMode ? "Now" : undefined,
    endTime: callTimes.at(-1) ?? totalDuration,
    stops,
    nextAction: moveMode
      ? "Open walking directions and move before the current room costs you the next block."
      : shouldSplit
        ? "Start at the first cafe, then decide after the first call whether the split is worth it."
        : "Start here, take the table with the best plug odds, and ask for a reroute if the room changes.",
    contingency: "If it gets loud, your battery drops, or a call becomes higher-stakes, use Find next spot.",
  };
}

function buildConciergeReply(
  message: string,
  intent: Intent,
  recommendations: Recommendation[],
  cafePool: Cafe[],
  userLocation?: UserLocation,
) {
  const topCafes = recommendations
    .slice(0, 2)
    .map((recommendation) => cafePool.find((cafe) => cafe.id === recommendation.cafeId)?.name)
    .filter(Boolean);
  const missing = buildFollowUpQuestions(message, intent, userLocation).length > 0;
  const taskPhrase = intent.task ? ` for ${intent.task}` : "";
  const placePhrase = intent.area ? ` around ${intent.area}` : userLocation ? " near you" : " across London";

  if (topCafes.length === 0) {
    return "I need a little more context before I can make a useful call. Tell me where you want to work from, how long you have, and whether plugs, quiet, or calls matter.";
  }

  const openingLine = missing
    ? `I can start with a practical shortlist${placePhrase}${taskPhrase}, but I need a bit more context to tune it properly.`
    : `For that work block${placePhrase}${taskPhrase}, I would start with ${topCafes.join(" or ")}.`;
  const caution = intent.needs.includes("open now")
    ? "I weighted live opening signals where Maps exposed them, and I marked anything uncertain."
    : "I weighted WiFi, plugs, noise, stay length, and proximity rather than just cafe rating.";

  return `${openingLine} ${caution}`;
}

export function recommendCafes(
  message: string,
  userLocation?: UserLocation,
  cafePool: Cafe[] = cafes,
  limit = 3,
  currentCafe?: Cafe,
): ConciergeResponse {
  const intent = inferIntent(message);
  const recommendations = cafePool
    .map((cafe) => {
      const match = matchCafe(cafe, intent, userLocation);
      return {
        cafeId: cafe.id,
        matchScore: toMatchScore(match.score),
        reason: match.reason,
        distanceKm: match.distanceKm,
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit)
    .map<Recommendation>((recommendation, index) => ({
      ...recommendation,
      rank: index + 1,
    }));

  const reply = buildConciergeReply(message, intent, recommendations, cafePool, userLocation);
  const followUpQuestions = buildFollowUpQuestions(message, intent, userLocation);

  return {
    intent,
    reply,
    followUpQuestions,
    recommendations,
    sessionPlan: buildWorkSessionPlan(message, recommendations, cafePool, userLocation, currentCafe),
    provider: "fallback",
  };
}

export function extractFeedback(rawReview: string): FeedbackExtraction {
  const text = rawReview.toLowerCase();
  const wifiScore = includesAny(text, [
    "excellent wifi",
    "wifi was excellent",
    "great wifi",
    "wifi was great",
    "fast wifi",
    "wifi was fast",
  ])
    ? 5
    : includesAny(text, ["bad wifi", "slow wifi", "patchy wifi"])
      ? 2
      : includesAny(text, ["wifi"])
        ? 4
        : undefined;

  const plugScore = includesAny(text, ["only two", "couple of sockets", "limited sockets", "limited plugs"])
    ? 2
    : includesAny(text, ["plenty of sockets", "lots of sockets", "many plugs"])
      ? 5
      : includesAny(text, ["socket", "plug"])
        ? 3
        : undefined;

  const seatingScore = includesAny(text, ["plenty of seats", "easy to sit", "lots of tables"])
    ? 5
    : includesAny(text, ["hard to find a seat", "no seats", "packed"])
      ? 2
      : undefined;

  const noiseLevel = includesAny(text, ["noisy after lunch", "loud after lunch"])
    ? "noisy_after_lunch"
    : includesAny(text, ["quiet", "calm"])
      ? "quiet"
      : includesAny(text, ["noisy", "loud"])
        ? "noisy"
        : includesAny(text, ["busy"])
          ? "busy"
          : undefined;

  const laptopFriendly = includesAny(text, ["laptop friendly", "worked for hours", "good for laptop"])
    ? true
    : includesAny(text, ["no laptops", "not laptop friendly"])
      ? false
      : undefined;

  const bestTime = includesAny(text, ["after lunch", "before lunch", "morning"])
    ? "Morning"
    : includesAny(text, ["afternoon"])
      ? "Afternoon"
      : undefined;

  const recommendedStay = plugScore && plugScore <= 2
    ? "1-2 hours"
    : includesAny(text, ["three hours", "3 hours", "worked for hours"])
      ? "2-3 hours"
      : "1-2 hours";

  const parts = [
    wifiScore ? `WiFi ${wifiScore}/5` : undefined,
    plugScore ? `plugs ${plugScore}/5` : undefined,
    noiseLevel ? `noise: ${String(noiseLevel).replaceAll("_", " ")}` : undefined,
  ].filter(Boolean);

  return {
    wifiScore,
    plugScore,
    seatingScore,
    noiseLevel,
    laptopFriendly,
    bestTime,
    recommendedStay,
    summary:
      parts.length > 0
        ? `${parts.join(", ")}. Best treated as a cafe work spot for ${recommendedStay}.`
        : "Useful feedback captured. More detail will improve the recommendation model.",
    provider: "fallback",
  };
}

function parseDurationHours(duration: string) {
  const match = duration.toLowerCase().match(/(\d+(?:\.\d+)?)/);
  return match ? Math.max(1, Number(match[1])) : 3;
}

export function generateWorkPlan(
  task: string,
  duration: string,
  cafeName: string,
): WorkBuddyResponse {
  const hours = parseDurationHours(duration);
  const totalMinutes = Math.round(hours * 60);
  const first = Math.max(30, Math.round(totalMinutes * 0.28));
  const second = Math.max(30, Math.round(totalMinutes * 0.27));
  const breakLength = totalMinutes >= 150 ? 10 : 5;
  const third = Math.max(25, Math.round(totalMinutes * 0.26));
  const final = Math.max(20, totalMinutes - first - second - breakLength - third);

  const slots = [first, second, breakLength, third, final];
  let cursor = 0;
  const ranges = slots.map((slot) => {
    const start = cursor;
    cursor += slot;
    return `${formatOffset(start)}-${formatOffset(cursor)}`;
  });

  const plan: WorkPlanItem[] = [
    {
      time: ranges[0],
      task: `Define the finish line for ${task || "the main task"} at ${cafeName}.`,
    },
    {
      time: ranges[1],
      task: "Build the highest-risk piece while energy is still high.",
    },
    {
      time: ranges[2],
      task: "Step away from the screen, refill water, reset the next block.",
    },
    {
      time: ranges[3],
      task: "Polish the visible demo path and remove anything distracting.",
    },
    {
      time: ranges[4],
      task: "Run the demo once, capture notes, and prepare the closing line.",
    },
  ];

  return {
    plan,
    provider: "fallback",
  };
}

function formatOffset(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}
