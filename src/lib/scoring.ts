import type { Cafe, NoiseLevel } from "./types";

type WorkScoreProfile = Pick<
  Cafe,
  | "wifiScore"
  | "plugScore"
  | "seatingScore"
  | "noiseLevel"
  | "laptopFriendly"
  | "callFriendly"
> &
  Partial<Pick<Cafe, "rating" | "recommendedStay">>;

function clampScore(score: number) {
  return Math.max(32, Math.min(96, Math.round(score)));
}

export function calculateWorkProfileScore(profile: WorkScoreProfile): number {
  let score = 48;

  score += (profile.wifiScore - 3) * 5;
  score += (profile.plugScore - 3) * 5;
  score += (profile.seatingScore - 3) * 4;

  score += profile.laptopFriendly ? 7 : -12;
  score += profile.callFriendly ? 4 : 0;

  if (profile.noiseLevel === "quiet") score += 7;
  if (profile.noiseLevel === "moderate") score += 2;
  if (profile.noiseLevel === "busy") score -= 5;
  if (profile.noiseLevel === "noisy") score -= 12;

  if (profile.recommendedStay?.includes("3")) score += 3;
  if (profile.recommendedStay?.includes("1-2")) score -= 2;

  if (typeof profile.rating === "number" && Number.isFinite(profile.rating)) {
    score += (profile.rating - 4.2) * 4;
  }

  return clampScore(score);
}

export function calculateWorkScore(cafe: Cafe): number {
  return calculateWorkProfileScore(cafe);
}

export function getWorkScoreLabel(score: number) {
  if (score >= 88) return "Excellent for work";
  if (score >= 74) return "Good for work";
  if (score >= 60) return "Fine for short sessions";
  return "Not ideal";
}

export function formatNoise(noise: NoiseLevel) {
  const labels: Record<NoiseLevel, string> = {
    quiet: "Quiet",
    moderate: "Moderate",
    busy: "Busy",
    noisy: "Noisy",
  };
  return labels[noise];
}

export function scoreTone(score: number) {
  if (score >= 88) return "text-emerald-700 dark:text-emerald-300";
  if (score >= 74) return "text-zinc-950 dark:text-zinc-50";
  if (score >= 60) return "text-amber-700 dark:text-amber-300";
  return "text-rose-700 dark:text-rose-300";
}
