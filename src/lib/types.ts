export type NoiseLevel = "quiet" | "moderate" | "busy" | "noisy";

export type Cafe = {
  id: string;
  name: string;
  area: string;
  address: string;
  lat: number;
  lng: number;
  rating: number;
  reviewCount: number;
  imageUrl: string;
  imageAlt: string;
  wifiScore: number;
  plugScore: number;
  seatingScore: number;
  noiseLevel: NoiseLevel;
  laptopFriendly: boolean;
  callFriendly: boolean;
  bestTime: string;
  recommendedStay: string;
  bestFor: string[];
  workSummary: string;
  foodHygieneRating?: number;
  openNow?: boolean;
  source: "seed" | "osm" | "user" | "google";
  googlePlaceId?: string;
  googleMapsUri?: string;
};

export type Intent = {
  area?: string;
  duration?: string;
  task?: string;
  needs: string[];
};

export type UserLocation = {
  lat: number;
  lng: number;
  accuracy?: number;
};

export type Recommendation = {
  cafeId: string;
  rank: number;
  reason: string;
  matchScore: number;
  distanceKm?: number;
};

export type WorkSessionStop = {
  id: string;
  cafeId: string;
  title: string;
  start: string;
  end: string;
  purpose: string;
  rationale: string;
  needs: string[];
  walkFromPreviousMin?: number;
  caution?: string;
};

export type WorkSessionPlan = {
  mode: "session_plan" | "mid_session_move";
  headline: string;
  summary: string;
  totalDuration?: string;
  startTime?: string;
  endTime?: string;
  stops: WorkSessionStop[];
  nextAction?: string;
  contingency?: string;
};

export type ConciergeResponse = {
  intent: Intent;
  reply: string;
  followUpQuestions: string[];
  recommendations: Recommendation[];
  sessionPlan?: WorkSessionPlan;
  provider: "openrouter" | "fallback";
};

export type FeedbackExtraction = {
  wifiScore?: number;
  plugScore?: number;
  seatingScore?: number;
  noiseLevel?: NoiseLevel | "noisy_after_lunch";
  laptopFriendly?: boolean;
  bestTime?: string;
  recommendedStay?: string;
  summary: string;
  provider: "openrouter" | "fallback";
};

export type WorkPlanItem = {
  time: string;
  task: string;
};

export type WorkBuddyResponse = {
  plan: WorkPlanItem[];
  provider: "openrouter" | "fallback";
};

export type EnrichedWorkProfile = {
  wifiScore: number;
  plugScore: number;
  seatingScore: number;
  noiseLevel: NoiseLevel;
  laptopFriendly: boolean;
  callFriendly: boolean;
  bestTime: string;
  recommendedStay: string;
  bestFor: string[];
  workSummary: string;
  evidence: string[];
  provider: "openrouter" | "fallback";
};

export type GoogleReviewSnippet = {
  authorName?: string;
  rating?: number;
  text: string;
  relativePublishTimeDescription?: string;
};

export type CafeMenuHighlight = {
  name: string;
  priceHint?: string;
  source: "review" | "google" | "estimate";
};

export type CafeWorkDetail = {
  label: string;
  value: string;
  detail: string;
  tone: "good" | "neutral" | "warn";
};

export type CafeAmenity = {
  label: string;
  source: "google" | "work_profile" | "estimate";
};

export type CafeCaution = {
  title: string;
  detail: string;
  source: "google" | "reviews" | "estimate";
};

export type CafeBusyLevel = "quiet" | "moderate" | "busy";

export type CafeBusyHour = {
  hour: number;
  value: number;
  level: CafeBusyLevel;
};

export type CafeBusyDay = {
  day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  label: string;
  summary: string;
  hours: CafeBusyHour[];
};

export type CafeBusyTimes = {
  source: "google_estimate" | "seed_estimate";
  quietestLabel: string;
  days: CafeBusyDay[];
};

export type CafePlaceDetails = {
  id: string;
  seedName: string;
  name: string;
  area: string;
  address: string;
  lat: number;
  lng: number;
  rating: number;
  reviewCount: number;
  imageUrl: string;
  imageAlt: string;
  source: "google_places" | "seed_fallback";
  matchConfidence: "high" | "medium" | "fallback";
  googlePlaceId?: string;
  googleMapsUri?: string;
  websiteUri?: string;
  phone?: string;
  businessStatus?: string;
  priceLevel?: string;
  openNow?: boolean;
  openingHours?: string[];
  editorialSummary?: string;
  reviewSnippets: GoogleReviewSnippet[];
  menuHighlights?: CafeMenuHighlight[];
  workDetails?: CafeWorkDetail[];
  knownFor?: string[];
  amenities?: CafeAmenity[];
  cautions?: CafeCaution[];
  busyTimes?: CafeBusyTimes;
  howWeKnow?: string[];
  workProfile: EnrichedWorkProfile;
};
