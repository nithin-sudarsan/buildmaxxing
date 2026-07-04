import { cafes } from "./cafes";
import {
  decodeGoogleCafeId,
  fetchGoogleCafePlaceDetails,
  googlePlaceToCafe,
} from "./google-cafes";
import { callOpenRouterJson } from "./openrouter";
import { calculateWorkScore } from "./scoring";
import { getFirstServerEnv } from "./server-env";
import type {
  Cafe,
  CafeAmenity,
  CafeBusyLevel,
  CafeBusyTimes,
  CafeCaution,
  CafeMenuHighlight,
  CafePlaceDetails,
  CafeWorkDetail,
  EnrichedWorkProfile,
  GoogleReviewSnippet,
  NoiseLevel,
} from "./types";

type LocalizedText = {
  text?: string;
  languageCode?: string;
};

type GooglePlacePhoto = {
  name?: string;
  authorAttributions?: Array<{ displayName?: string; uri?: string; photoUri?: string }>;
};

type GooglePlaceReview = {
  name?: string;
  relativePublishTimeDescription?: string;
  rating?: number;
  text?: LocalizedText;
  originalText?: LocalizedText;
  authorAttribution?: {
    displayName?: string;
    uri?: string;
    photoUri?: string;
  };
};

type GooglePlace = {
  id?: string;
  name?: string;
  displayName?: LocalizedText;
  formattedAddress?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  businessStatus?: string;
  priceLevel?: string;
  editorialSummary?: LocalizedText;
  currentOpeningHours?: {
    openNow?: boolean;
    weekdayDescriptions?: string[];
  };
  regularOpeningHours?: {
    openNow?: boolean;
    weekdayDescriptions?: string[];
  };
  photos?: GooglePlacePhoto[];
  reviews?: GooglePlaceReview[];
  types?: string[];
  servesCoffee?: boolean;
  servesBreakfast?: boolean;
  servesBrunch?: boolean;
  outdoorSeating?: boolean;
  restroom?: boolean;
};

type SearchResponse = {
  places?: GooglePlace[];
};

type WorkProfileCandidate = Partial<EnrichedWorkProfile>;

const SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.types",
].join(",");

const DETAILS_FIELD_MASK = [
  "id",
  "name",
  "displayName",
  "formattedAddress",
  "location",
  "rating",
  "userRatingCount",
  "googleMapsUri",
  "websiteUri",
  "nationalPhoneNumber",
  "businessStatus",
  "priceLevel",
  "editorialSummary",
  "currentOpeningHours",
  "regularOpeningHours",
  "photos",
  "reviews",
  "types",
  "servesCoffee",
  "servesBreakfast",
  "servesBrunch",
  "outdoorSeating",
  "restroom",
].join(",");

const detailsCache = new Map<string, Promise<CafePlaceDetails>>();

function clampScore(value: unknown, fallback: number) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(5, Math.round(number)));
}

function normalizeNoise(value: unknown, fallback: NoiseLevel): NoiseLevel {
  if (value === "quiet" || value === "moderate" || value === "busy" || value === "noisy") {
    return value;
  }
  return fallback;
}

function textOf(value?: LocalizedText) {
  return value?.text?.trim() || undefined;
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const earthRadius = 6371000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latA = toRadians(a.lat);
  const latB = toRadians(b.lat);
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function fetchJson<T>(url: string, init: RequestInit, fieldMask: string) {
  const apiKey = await getFirstServerEnv("GOOGLE_MAPS_API_KEY", "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
  if (!apiKey) return null;

  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
      ...(init.headers ?? {}),
    },
    next: { revalidate: 60 * 60 * 6 },
  });

  if (!response.ok) return null;
  return (await response.json()) as T;
}

function searchQueries(cafe: Cafe) {
  return [
    `${cafe.name} ${cafe.address} London cafe`,
    `cafe ${cafe.area} London`,
  ];
}

async function searchPlace(cafe: Cafe) {
  for (const textQuery of searchQueries(cafe)) {
    const payload = await fetchJson<SearchResponse>(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        body: JSON.stringify({
          textQuery,
          includedType: "cafe",
          strictTypeFiltering: false,
          pageSize: 5,
          regionCode: "GB",
          languageCode: "en",
          locationBias: {
            circle: {
              center: { latitude: cafe.lat, longitude: cafe.lng },
              radius: 900,
            },
          },
        }),
      },
      SEARCH_FIELD_MASK,
    );

    const places = payload?.places?.filter((place) => place.id && place.location) ?? [];
    if (places.length > 0) {
      return places.sort((a, b) => {
        const distanceA = distanceMeters(
          { lat: cafe.lat, lng: cafe.lng },
          { lat: a.location?.latitude ?? cafe.lat, lng: a.location?.longitude ?? cafe.lng },
        );
        const distanceB = distanceMeters(
          { lat: cafe.lat, lng: cafe.lng },
          { lat: b.location?.latitude ?? cafe.lat, lng: b.location?.longitude ?? cafe.lng },
        );
        return distanceA - distanceB;
      })[0];
    }
  }

  return null;
}

async function fetchPlaceDetails(placeId: string) {
  return fetchJson<GooglePlace>(
    `https://places.googleapis.com/v1/places/${placeId}`,
    {
      method: "GET",
    },
    DETAILS_FIELD_MASK,
  );
}

function photoUrl(place: GooglePlace | undefined, fallback: string) {
  const photoName = place?.photos?.find((photo) => photo.name)?.name;
  if (!photoName) return fallback;
  return `/api/places/photo?name=${encodeURIComponent(photoName)}&width=1100`;
}

function normalizeReviews(place?: GooglePlace): GoogleReviewSnippet[] {
  const snippets: GoogleReviewSnippet[] = [];

  for (const review of place?.reviews ?? []) {
    const text = textOf(review.text) ?? textOf(review.originalText);
    if (!text) continue;
    snippets.push({
      authorName: review.authorAttribution?.displayName,
      rating: review.rating,
      text: text.length > 220 ? `${text.slice(0, 217).trim()}...` : text,
      relativePublishTimeDescription: review.relativePublishTimeDescription,
    });
  }

  return snippets.slice(0, 3);
}

function hashString(seed: string) {
  return Array.from(seed).reduce((total, character) => total + character.charCodeAt(0), 0);
}

function clampPercent(value: number) {
  return Math.max(8, Math.min(94, Math.round(value)));
}

function uniqueStrings(items: Array<string | undefined>) {
  return Array.from(new Set(items.filter((item): item is string => Boolean(item?.trim()))));
}

function placeSearchText(cafe: Cafe, place?: GooglePlace) {
  return [
    cafe.name,
    cafe.area,
    cafe.workSummary,
    textOf(place?.displayName),
    textOf(place?.editorialSummary),
    ...(place?.reviews ?? []).map((review) => textOf(review.text) ?? textOf(review.originalText)),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const menuPatterns = [
  { name: "Cappuccino", regex: /\bcappuccino\b/i, priceHint: "£3-5" },
  { name: "Flat white", regex: /\bflat\s+white\b/i, priceHint: "£3-5" },
  { name: "Latte", regex: /\blatte\b/i, priceHint: "£3-5" },
  { name: "Espresso", regex: /\bespresso\b/i, priceHint: "£2-4" },
  { name: "Cold brew", regex: /\bcold\s+(brew|coffee)\b/i, priceHint: "£4-6" },
  { name: "Matcha", regex: /\bmatcha\b/i, priceHint: "£4-6" },
  { name: "Chai", regex: /\bchai\b/i, priceHint: "£4-6" },
  { name: "Affogato", regex: /\baffogato\b/i, priceHint: "menu varies" },
  { name: "Croissant", regex: /\bcroissant\b/i, priceHint: "£3-5" },
  { name: "Banana bread", regex: /\bbanana\s+(bread|cake)\b/i, priceHint: "£3-5" },
  { name: "Cake", regex: /\bcake\b/i, priceHint: "£4-6" },
  { name: "Toast", regex: /\b(toast|toastie|sourdough)\b/i, priceHint: "£5-10" },
  { name: "Sandwich", regex: /\b(sandwich|bagel)\b/i, priceHint: "£5-9" },
  { name: "Brunch", regex: /\bbrunch\b/i, priceHint: "£8-14" },
];

function buildMenuHighlights(cafe: Cafe, place?: GooglePlace): CafeMenuHighlight[] {
  const text = placeSearchText(cafe, place);
  const highlights: CafeMenuHighlight[] = [];

  for (const item of menuPatterns) {
    if (!item.regex.test(text)) continue;
    highlights.push({
      name: item.name,
      priceHint: item.priceHint,
      source: "review",
    });
  }

  const fallbackItems: CafeMenuHighlight[] = [
    {
      name: "Cappuccino",
      priceHint: "£3-5 typical range",
      source: place?.servesCoffee ? "google" : "estimate",
    },
    {
      name: "Flat white",
      priceHint: "£3-5 typical range",
      source: place?.servesCoffee ? "google" : "estimate",
    },
    {
      name: place?.servesBreakfast || place?.servesBrunch ? "Brunch plate" : "Pastry",
      priceHint: place?.servesBreakfast || place?.servesBrunch ? "menu varies" : "£3-5 typical item",
      source: place?.servesBreakfast || place?.servesBrunch ? "google" : "estimate",
    },
  ];

  for (const item of fallbackItems) {
    if (highlights.some((existing) => existing.name.toLowerCase() === item.name.toLowerCase())) continue;
    highlights.push(item);
  }

  return highlights.slice(0, 4);
}

function buildKnownFor(
  menuHighlights: CafeMenuHighlight[],
  profile: EnrichedWorkProfile,
  place?: GooglePlace,
) {
  return uniqueStrings([
    ...menuHighlights
      .filter((item) => item.source !== "estimate")
      .map((item) => item.name.toLowerCase()),
    place?.servesCoffee ? "coffee" : undefined,
    place?.servesBreakfast ? "breakfast" : undefined,
    place?.servesBrunch ? "brunch" : undefined,
    profile.noiseLevel === "quiet" ? "quiet work" : undefined,
    profile.plugScore >= 4 ? "plug access" : undefined,
  ]).slice(0, 6);
}

function workValue(score: number, high: string, mid: string, low: string) {
  if (score >= 4) return high;
  if (score >= 3) return mid;
  return low;
}

function buildWorkDetails(profile: EnrichedWorkProfile): CafeWorkDetail[] {
  return [
    {
      label: "Wi-Fi",
      value: workValue(profile.wifiScore, "Strong", "Usable", "Weak"),
      detail: profile.wifiScore >= 4
        ? "Good enough for laptop sessions and calls with a backup plan."
        : "Fine for browsing, but do not assume heavy uploads will be smooth.",
      tone: profile.wifiScore >= 4 ? "good" : "neutral",
    },
    {
      label: "Power outlets",
      value: workValue(profile.plugScore, "Plenty", "Some", "Limited"),
      detail: profile.plugScore >= 4
        ? "Best odds of finding a socket without rearranging your day."
        : "Arrive charged or plan a shorter session.",
      tone: profile.plugScore >= 4 ? "good" : profile.plugScore >= 3 ? "neutral" : "warn",
    },
    {
      label: "Seating for work",
      value: workValue(profile.seatingScore, "Spacious", "Workable", "Tight"),
      detail: profile.recommendedStay,
      tone: profile.seatingScore >= 4 ? "good" : "neutral",
    },
    {
      label: "Noise",
      value: profile.noiseLevel === "quiet"
        ? "Quiet"
        : profile.noiseLevel === "moderate"
          ? "Moderate"
          : profile.noiseLevel === "busy"
            ? "Busy"
            : "Noisy",
      detail: profile.noiseLevel === "quiet"
        ? "Good fit for focus blocks."
        : profile.noiseLevel === "moderate"
          ? "Manageable for most solo work."
          : "Better for admin, light work, or headphones.",
      tone: profile.noiseLevel === "quiet" || profile.noiseLevel === "moderate" ? "good" : "warn",
    },
    {
      label: "Calls",
      value: profile.callFriendly ? "Possible" : "Maybe not",
      detail: profile.callFriendly
        ? "Should work for short calls if you pick a careful seat."
        : "Treat calls as a maybe; use headphones and avoid peak hours.",
      tone: profile.callFriendly ? "neutral" : "warn",
    },
  ];
}

function buildAmenities(profile: EnrichedWorkProfile, place?: GooglePlace): CafeAmenity[] {
  const amenities: CafeAmenity[] = [
    profile.laptopFriendly ? { label: "Laptop friendly", source: "work_profile" } : undefined,
    profile.wifiScore >= 4 ? { label: "Strong Wi-Fi", source: "work_profile" } : undefined,
    profile.plugScore >= 4 ? { label: "Power outlets", source: "work_profile" } : undefined,
    profile.callFriendly ? { label: "Call-friendly corners", source: "work_profile" } : undefined,
    place?.outdoorSeating ? { label: "Outdoor seating", source: "google" } : undefined,
    place?.restroom ? { label: "Restroom", source: "google" } : undefined,
    place?.servesBreakfast ? { label: "Breakfast", source: "google" } : undefined,
    place?.servesBrunch ? { label: "Brunch", source: "google" } : undefined,
  ].filter((item): item is CafeAmenity => Boolean(item));

  if (amenities.length > 0) return amenities.slice(0, 8);

  return [
    { label: "Coffee", source: "estimate" },
    { label: "Short work sessions", source: "estimate" },
  ];
}

function buildCautions(
  cafe: Cafe,
  profile: EnrichedWorkProfile,
  place?: GooglePlace,
): CafeCaution[] {
  const cautions: CafeCaution[] = [];

  if (place?.businessStatus && place.businessStatus !== "OPERATIONAL") {
    cautions.push({
      title: "Status needs checking",
      detail: `Google status is ${place.businessStatus.replaceAll("_", " ").toLowerCase()}.`,
      source: "google",
    });
  }

  const openNow = place?.currentOpeningHours?.openNow ?? place?.regularOpeningHours?.openNow ?? cafe.openNow;
  if (openNow === false) {
    cautions.push({
      title: "Closed right now",
      detail: "Check hours before walking over.",
      source: "google",
    });
  }

  if (profile.noiseLevel === "busy" || profile.noiseLevel === "noisy") {
    cautions.push({
      title: "Can get lively",
      detail: "Better with headphones or outside the lunch and after-work peaks.",
      source: "estimate",
    });
  }

  if (profile.plugScore <= 2) {
    cautions.push({
      title: "Limited charging",
      detail: "Bring a charged laptop or pick this for a shorter work sprint.",
      source: "estimate",
    });
  }

  if (!profile.callFriendly) {
    cautions.push({
      title: "Calls are not the main use case",
      detail: "Good for laptop work, less reliable for long meetings.",
      source: "estimate",
    });
  }

  return cautions.slice(0, 2);
}

const busyDayDefinitions: CafeBusyTimes["days"][number]["day"][] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

const busyDayLabels: Record<CafeBusyTimes["days"][number]["day"], string> = {
  mon: "Mo",
  tue: "Tu",
  wed: "We",
  thu: "Th",
  fri: "Fr",
  sat: "Sa",
  sun: "Su",
};

function busyLevel(value: number): CafeBusyLevel {
  if (value < 34) return "quiet";
  if (value < 64) return "moderate";
  return "busy";
}

function buildBusyTimes(
  cafe: Cafe,
  profile: EnrichedWorkProfile,
  place?: GooglePlace,
): CafeBusyTimes {
  const reviewCount = place?.userRatingCount ?? cafe.reviewCount;
  const popularity = Math.min(24, Math.log10(reviewCount + 1) * 7);
  const noiseOffset = profile.noiseLevel === "quiet"
    ? -10
    : profile.noiseLevel === "moderate"
      ? 0
      : profile.noiseLevel === "busy"
        ? 12
        : 20;
  const seed = hashString(place?.id ?? cafe.id);
  const hours = Array.from({ length: 18 }, (_, index) => index + 6);
  const dayProfiles = busyDayDefinitions.map((day, dayIndex) => {
    const weekend = day === "sat" || day === "sun";
    const fridayLift = day === "fri" ? 7 : 0;
    const dayVariance = ((seed + dayIndex * 7) % 9) - 4;
    const busyHours = hours.map((hour) => {
      const morningBump = Math.exp(-Math.pow((hour - (weekend ? 11 : 9)) / 2.2, 2)) * 15;
      const lunchBump = Math.exp(-Math.pow((hour - 13) / 2.8, 2)) * (weekend ? 28 : 24);
      const eveningBump = Math.exp(-Math.pow((hour - (weekend ? 17 : 18)) / 3.1, 2)) * (weekend ? 22 : 18);
      const earlyCalm = hour < 9 ? -16 : 0;
      const lateCalm = hour > 21 ? -12 : 0;
      const weekendLift = weekend && hour >= 10 && hour <= 17 ? 10 : 0;
      const value = clampPercent(
        18 +
          popularity +
          noiseOffset +
          dayVariance +
          fridayLift +
          weekendLift +
          morningBump +
          lunchBump +
          eveningBump +
          earlyCalm +
          lateCalm,
      );

      return {
        hour,
        value,
        level: busyLevel(value),
      };
    });

    const busiest = busyHours.reduce((current, next) => next.value > current.value ? next : current, busyHours[0]);
    const summary = busiest.value >= 70
      ? `Usually busiest around ${formatHourLabel(busiest.hour)}`
      : busiest.value >= 48
        ? `Moderate peak around ${formatHourLabel(busiest.hour)}`
        : "Generally calm";

    return {
      day,
      label: busyDayLabels[day],
      summary,
      hours: busyHours,
    };
  });

  const weekdayHours = dayProfiles
    .filter((day) => !["sat", "sun"].includes(day.day))
    .flatMap((day) => day.hours.filter((hour) => hour.hour >= 6 && hour.hour <= 11));
  const quietest = weekdayHours.reduce((current, next) => next.value < current.value ? next : current, weekdayHours[0]);

  return {
    source: place ? "google_estimate" : "seed_estimate",
    quietestLabel: `Quietest around ${formatHourLabel(quietest.hour)} on weekdays`,
    days: dayProfiles,
  };
}

function formatHourLabel(hour: number) {
  if (hour === 0 || hour === 24) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour > 12) return `${hour - 12} PM`;
  return `${hour} AM`;
}

function buildHowWeKnow(
  place: GooglePlace | undefined,
  profile: EnrichedWorkProfile,
  menuHighlights: CafeMenuHighlight[],
) {
  return uniqueStrings([
    place ? "Google Places" : "Seed data",
    place?.reviews?.length ? "Google reviews" : undefined,
    profile.provider === "openrouter" ? "AI review analysis" : undefined,
    menuHighlights.some((item) => item.source === "review") ? "Menu mentions in reviews" : undefined,
    "Work suitability estimate",
  ]);
}

function fallbackWorkProfile(cafe: Cafe, place?: GooglePlace): EnrichedWorkProfile {
  const openingHours = place?.currentOpeningHours?.weekdayDescriptions ?? place?.regularOpeningHours?.weekdayDescriptions;
  const openHint = openingHours?.[0]?.replace(/^[^:]+:\s*/, "");
  const reviewSignals = normalizeReviews(place)
    .map((review) => review.text)
    .slice(0, 2);
  const tags = [
    ...cafe.bestFor,
    place?.outdoorSeating ? "outdoor seating" : undefined,
    place?.servesBreakfast || place?.servesBrunch ? "morning friendly" : undefined,
  ].filter((tag): tag is string => Boolean(tag));

  return {
    wifiScore: cafe.wifiScore,
    plugScore: cafe.plugScore,
    seatingScore: cafe.seatingScore,
    noiseLevel: cafe.noiseLevel,
    laptopFriendly: cafe.laptopFriendly,
    callFriendly: cafe.callFriendly,
    bestTime: openHint ? `Check current hours, often ${openHint}` : cafe.bestTime,
    recommendedStay: cafe.recommendedStay,
    bestFor: Array.from(new Set(tags)).slice(0, 5),
    workSummary:
      textOf(place?.editorialSummary) ??
      [
        `${place?.displayName?.text ?? cafe.name} is a Google Places cafe match near ${cafe.area}.`,
        place?.rating
          ? `It carries a ${place.rating} rating from ${place.userRatingCount ?? "multiple"} Google reviews.`
          : undefined,
        reviewSignals.length
          ? `Recent review text mentions: ${reviewSignals.join(" ")}`
          : "Work-specific signals are inferred cautiously from Maps data and the cafe category.",
      ]
        .filter(Boolean)
        .join(" "),
    evidence: [
      place?.rating ? `Google rating ${place.rating} from ${place.userRatingCount ?? "many"} reviews` : undefined,
      place?.businessStatus ? `Status: ${place.businessStatus.replaceAll("_", " ").toLowerCase()}` : undefined,
      place?.outdoorSeating ? "Google lists outdoor seating" : undefined,
      place?.restroom ? "Google lists restrooms" : undefined,
    ].filter((item): item is string => Boolean(item)),
    provider: "fallback",
  };
}

async function analyzeWorkProfile(cafe: Cafe, place?: GooglePlace): Promise<EnrichedWorkProfile> {
  const fallback = fallbackWorkProfile(cafe, place);
  const reviewText = normalizeReviews(place).map((review) => ({
    rating: review.rating,
    text: review.text,
    when: review.relativePublishTimeDescription,
  }));

  const analysis = await callOpenRouterJson<WorkProfileCandidate>([
    {
      role: "system",
      content:
        "You analyze Google Places cafe data for work suitability. Return JSON only with wifiScore, plugScore, seatingScore as 1-5, noiseLevel as quiet/moderate/busy/noisy, laptopFriendly, callFriendly, bestTime, recommendedStay, bestFor array, workSummary, evidence array, provider. Base the summary and evidence on the Google place fields and review text, not seed copy. If WiFi, sockets, seating, or call suitability are not directly evidenced, infer cautiously and say the inference is cautious in evidence.",
    },
    {
      role: "user",
      content: JSON.stringify({
        cafeArea: cafe.area,
        googlePlace: {
          name: place?.displayName?.text,
          address: place?.formattedAddress,
          rating: place?.rating,
          reviewCount: place?.userRatingCount,
          businessStatus: place?.businessStatus,
          priceLevel: place?.priceLevel,
          editorialSummary: textOf(place?.editorialSummary),
          openingHours:
            place?.currentOpeningHours?.weekdayDescriptions ??
            place?.regularOpeningHours?.weekdayDescriptions,
          types: place?.types,
          servesCoffee: place?.servesCoffee,
          servesBreakfast: place?.servesBreakfast,
          servesBrunch: place?.servesBrunch,
          outdoorSeating: place?.outdoorSeating,
          restroom: place?.restroom,
          reviews: reviewText,
        },
        requiredShape: {
          wifiScore: "1-5 number",
          plugScore: "1-5 number",
          seatingScore: "1-5 number",
          noiseLevel: "quiet | moderate | busy | noisy",
          laptopFriendly: "boolean",
          callFriendly: "boolean",
          bestTime: "short string",
          recommendedStay: "short string",
          bestFor: ["short tags"],
          workSummary: "2 sentence Google-derived summary",
          evidence: ["Google-derived evidence strings"],
          provider: "openrouter",
        },
      }),
    },
  ]);

  if (!analysis?.workSummary) return fallback;

  return {
    wifiScore: clampScore(analysis.wifiScore, fallback.wifiScore),
    plugScore: clampScore(analysis.plugScore, fallback.plugScore),
    seatingScore: clampScore(analysis.seatingScore, fallback.seatingScore),
    noiseLevel: normalizeNoise(analysis.noiseLevel, fallback.noiseLevel),
    laptopFriendly:
      typeof analysis.laptopFriendly === "boolean" ? analysis.laptopFriendly : fallback.laptopFriendly,
    callFriendly:
      typeof analysis.callFriendly === "boolean" ? analysis.callFriendly : fallback.callFriendly,
    bestTime: analysis.bestTime?.trim() || fallback.bestTime,
    recommendedStay: analysis.recommendedStay?.trim() || fallback.recommendedStay,
    bestFor: Array.isArray(analysis.bestFor) && analysis.bestFor.length > 0
      ? analysis.bestFor.map(String).slice(0, 5)
      : fallback.bestFor,
    workSummary: analysis.workSummary,
    evidence: Array.isArray(analysis.evidence) && analysis.evidence.length > 0
      ? analysis.evidence.map(String).slice(0, 5)
      : fallback.evidence,
    provider: "openrouter",
  };
}

function matchConfidence(cafe: Cafe, place?: GooglePlace): CafePlaceDetails["matchConfidence"] {
  if (!place?.location) return "fallback";
  const distance = distanceMeters(
    { lat: cafe.lat, lng: cafe.lng },
    { lat: place.location.latitude ?? cafe.lat, lng: place.location.longitude ?? cafe.lng },
  );
  return distance <= 450 ? "high" : "medium";
}

async function buildCafePlaceDetails(cafe: Cafe, suppliedPlace?: GooglePlace): Promise<CafePlaceDetails> {
  const match = suppliedPlace ?? await searchPlace(cafe);
  const place = suppliedPlace ?? (match?.id ? await fetchPlaceDetails(match.id) : null);
  const resolvedPlace = place ?? match ?? undefined;
  const workProfile = await analyzeWorkProfile(cafe, resolvedPlace);
  const menuHighlights = buildMenuHighlights(cafe, resolvedPlace);
  const workDetails = buildWorkDetails(workProfile);
  const knownFor = buildKnownFor(menuHighlights, workProfile, resolvedPlace);
  const amenities = buildAmenities(workProfile, resolvedPlace);
  const cautions = buildCautions(cafe, workProfile, resolvedPlace);
  const busyTimes = buildBusyTimes(cafe, workProfile, resolvedPlace);
  const howWeKnow = buildHowWeKnow(resolvedPlace, workProfile, menuHighlights);

  return {
    id: cafe.id,
    seedName: cafe.name,
    name: textOf(resolvedPlace?.displayName) ?? cafe.name,
    area: cafe.area,
    address: resolvedPlace?.formattedAddress ?? cafe.address,
    lat: resolvedPlace?.location?.latitude ?? cafe.lat,
    lng: resolvedPlace?.location?.longitude ?? cafe.lng,
    rating: resolvedPlace?.rating ?? cafe.rating,
    reviewCount: resolvedPlace?.userRatingCount ?? cafe.reviewCount,
    imageUrl: photoUrl(resolvedPlace, cafe.imageUrl),
    imageAlt: `${textOf(resolvedPlace?.displayName) ?? cafe.name} from Google Places`,
    source: resolvedPlace ? "google_places" : "seed_fallback",
    matchConfidence: matchConfidence(cafe, resolvedPlace),
    googlePlaceId: resolvedPlace?.id,
    googleMapsUri: resolvedPlace?.googleMapsUri,
    websiteUri: resolvedPlace?.websiteUri,
    phone: resolvedPlace?.nationalPhoneNumber,
    businessStatus: resolvedPlace?.businessStatus,
    priceLevel: resolvedPlace?.priceLevel,
    openNow: resolvedPlace?.currentOpeningHours?.openNow ?? resolvedPlace?.regularOpeningHours?.openNow,
    openingHours:
      resolvedPlace?.currentOpeningHours?.weekdayDescriptions ??
      resolvedPlace?.regularOpeningHours?.weekdayDescriptions,
    editorialSummary: textOf(resolvedPlace?.editorialSummary),
    reviewSnippets: normalizeReviews(resolvedPlace),
    menuHighlights,
    workDetails,
    knownFor,
    amenities,
    cautions,
    busyTimes,
    howWeKnow,
    workProfile,
  };
}

export async function getCafePlaceDetails(id: string) {
  const cafe = cafes.find((item) => item.id === id);
  const googlePlaceId = decodeGoogleCafeId(id);

  if (!cafe && googlePlaceId) {
    if (!detailsCache.has(id)) {
      detailsCache.set(id, (async () => {
        const place = await fetchGoogleCafePlaceDetails(googlePlaceId);
        if (!place) throw new Error("Google cafe not found");
        const googleCafe = googlePlaceToCafe(place);
        if (!googleCafe) throw new Error("Google cafe cannot be normalized");
        return buildCafePlaceDetails(googleCafe, place as GooglePlace);
      })());
    }

    try {
      return await (detailsCache.get(id) ?? null);
    } catch {
      detailsCache.delete(id);
      return null;
    }
  }

  if (!cafe) return null;

  if (!detailsCache.has(id)) {
    detailsCache.set(id, buildCafePlaceDetails(cafe));
  }

  try {
    return await (detailsCache.get(id) ?? null);
  } catch {
    detailsCache.delete(id);
    return null;
  }
}

export function scoreFromWorkProfile(profile: EnrichedWorkProfile) {
  const cafeLike = {
    wifiScore: profile.wifiScore,
    plugScore: profile.plugScore,
    seatingScore: profile.seatingScore,
    noiseLevel: profile.noiseLevel,
    laptopFriendly: profile.laptopFriendly,
    callFriendly: profile.callFriendly,
  } as Cafe;

  return calculateWorkScore(cafeLike);
}
