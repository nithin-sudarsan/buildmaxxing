import { Buffer } from "node:buffer";
import { cafes as seedCafes } from "./cafes";
import { calculateWorkScore } from "./scoring";
import type { Cafe, NoiseLevel } from "./types";

type LocalizedText = {
  text?: string;
  languageCode?: string;
};

type GooglePlacePhoto = {
  name?: string;
};

export type GoogleCafePlace = {
  id?: string;
  name?: string;
  displayName?: LocalizedText;
  formattedAddress?: string;
  shortFormattedAddress?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  businessStatus?: string;
  currentOpeningHours?: {
    openNow?: boolean;
    weekdayDescriptions?: string[];
  };
  regularOpeningHours?: {
    openNow?: boolean;
    weekdayDescriptions?: string[];
  };
  photos?: GooglePlacePhoto[];
  types?: string[];
};

type NearbySearchResponse = {
  places?: GoogleCafePlace[];
};

const DISCOVERY_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.shortFormattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.businessStatus",
  "places.currentOpeningHours",
  "places.photos",
  "places.types",
].join(",");

const DETAILS_FIELD_MASK = [
  "id",
  "name",
  "displayName",
  "formattedAddress",
  "shortFormattedAddress",
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

const londonDiscoveryPoints = [
  { area: "Shoreditch", lat: 51.5247, lng: -0.0752, radius: 1300 },
  { area: "Soho", lat: 51.5135, lng: -0.1354, radius: 1200 },
  { area: "King's Cross", lat: 51.5363, lng: -0.124, radius: 1300 },
  { area: "Clerkenwell", lat: 51.5233, lng: -0.104, radius: 1200 },
  { area: "Farringdon", lat: 51.5202, lng: -0.1059, radius: 1100 },
  { area: "London Bridge", lat: 51.5055, lng: -0.0865, radius: 1300 },
  { area: "South Bank", lat: 51.5067, lng: -0.1156, radius: 1300 },
  { area: "Waterloo", lat: 51.5009, lng: -0.1115, radius: 1200 },
  { area: "Hackney", lat: 51.5448, lng: -0.0554, radius: 1500 },
  { area: "Camden", lat: 51.5392, lng: -0.1426, radius: 1400 },
  { area: "Notting Hill", lat: 51.5152, lng: -0.2045, radius: 1400 },
  { area: "Brixton", lat: 51.4626, lng: -0.1124, radius: 1400 },
  { area: "Greenwich", lat: 51.4811, lng: -0.0093, radius: 1400 },
  { area: "Canary Wharf", lat: 51.5049, lng: -0.0195, radius: 1400 },
  { area: "Victoria", lat: 51.4952, lng: -0.1446, radius: 1300 },
  { area: "Marylebone", lat: 51.5187, lng: -0.1507, radius: 1200 },
  { area: "Mayfair", lat: 51.5095, lng: -0.1478, radius: 1100 },
  { area: "Kensington", lat: 51.4991, lng: -0.1938, radius: 1400 },
  { area: "Islington", lat: 51.5386, lng: -0.1022, radius: 1400 },
  { area: "Dalston", lat: 51.5465, lng: -0.0751, radius: 1400 },
];

const fallbackImages = [
  "/workcafes/cafe-quiet-corner.png",
  "/workcafes/cafe-shared-table.png",
  "/workcafes/cafe-window-seat.png",
  "/workcafes/cafe-station-table.png",
];

let expandedCafeCache: Promise<Cafe[]> | null = null;

function getPlacesApiKey() {
  return process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
}

async function fetchGoogleJson<T>(url: string, init: RequestInit, fieldMask: string) {
  const apiKey = getPlacesApiKey();
  if (!apiKey) return null;

  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
      ...(init.headers ?? {}),
    },
    next: { revalidate: 60 * 60 * 12 },
  });

  if (!response.ok) return null;
  return (await response.json()) as T;
}

function textOf(value?: LocalizedText) {
  return value?.text?.trim() || undefined;
}

function hashString(seed: string) {
  return Array.from(seed).reduce((total, character) => total + character.charCodeAt(0), 0);
}

function clampMetric(value: number) {
  return Math.max(1, Math.min(5, Math.round(value)));
}

function fallbackPhoto(seed: string) {
  return fallbackImages[hashString(seed) % fallbackImages.length];
}

function placePhotoUrl(place: GoogleCafePlace) {
  const photoName = place.photos?.find((photo) => photo.name)?.name;
  if (!photoName) return fallbackPhoto(place.id ?? textOf(place.displayName) ?? "cafe");
  return `/api/places/photo?name=${encodeURIComponent(photoName)}&width=900`;
}

function nearestArea(place: GoogleCafePlace, fallbackArea?: string) {
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  if (lat === undefined || lng === undefined) return fallbackArea ?? "London";

  return londonDiscoveryPoints
    .map((point) => ({
      area: point.area,
      distance: Math.hypot(point.lat - lat, point.lng - lng),
    }))
    .sort((a, b) => a.distance - b.distance)[0]?.area ?? fallbackArea ?? "London";
}

function normalizeNoise(place: GoogleCafePlace, hash: number): NoiseLevel {
  if (place.currentOpeningHours?.openNow === false) return "moderate";
  if ((place.userRatingCount ?? 0) > 900) return "busy";
  if ((place.rating ?? 0) >= 4.6 && hash % 3 === 0) return "quiet";
  if (hash % 5 === 0) return "busy";
  return "moderate";
}

function workSignalsFromPlace(place: GoogleCafePlace) {
  const rating = place.rating ?? 4.1;
  const reviewCount = place.userRatingCount ?? 0;
  const hash = hashString(place.id ?? textOf(place.displayName) ?? "");
  const popularPenalty = reviewCount > 800 ? 1 : 0;
  const confidenceBoost = rating >= 4.4 ? 1 : 0;
  const quieter = normalizeNoise(place, hash) === "quiet";

  const wifiScore = clampMetric(3 + confidenceBoost + (reviewCount >= 250 ? 1 : 0) - (rating < 4 ? 1 : 0));
  const plugScore = Math.min(
    4,
    clampMetric(3 + (hash % 4 === 0 ? 1 : 0) + (quieter ? 1 : 0) - popularPenalty),
  );
  const seatingScore = Math.min(
    4,
    clampMetric(3 + (reviewCount >= 120 ? 1 : 0) + (hash % 6 === 0 ? 1 : 0) - popularPenalty),
  );

  return {
    wifiScore,
    plugScore,
    seatingScore,
    noiseLevel: normalizeNoise(place, hash),
    laptopFriendly: rating >= 4 || reviewCount >= 80,
    callFriendly: quieter || (hash % 7 === 0 && reviewCount < 500),
  };
}

function isCoffeeLikeName(name: string) {
  const lower = name.toLowerCase();
  return [
    "cafe",
    "caffe",
    "coffee",
    "espresso",
    "roast",
    "bakery",
    "bistro",
    "tea",
    "sandwich",
    "watchhouse",
    "blank street",
    "black sheep",
    "gail",
    "pret",
    "notes",
    "foyles",
    "redemption",
    "workshop",
    "origin",
    "kiss the hippo",
  ].some((word) => lower.includes(word));
}

function isLikelyWorkCafe(place: GoogleCafePlace) {
  const name = textOf(place.displayName) ?? "";
  const lower = name.toLowerCase();
  const types = new Set(place.types ?? []);
  const coffeeLike = isCoffeeLikeName(name);
  const blockedName = [
    "restaurant",
    "bar",
    "pub",
    "tavern",
    "grill",
    "steak",
    "pizza",
    "burger",
    "ramen",
    "tantuni",
    "permit room",
    "dishoom",
  ].some((word) => lower.includes(word));

  if (types.has("bar") || types.has("pub") || types.has("night_club")) return false;
  if (blockedName && !coffeeLike) return false;
  if ((place.userRatingCount ?? 0) > 8000 && !coffeeLike) return false;
  if (types.has("restaurant") && !coffeeLike && !types.has("cafe")) return false;
  return true;
}

function bestFor(place: GoogleCafePlace, area: string, signals: ReturnType<typeof workSignalsFromPlace>) {
  const tags = [
    signals.wifiScore >= 4 ? "wifi" : undefined,
    signals.plugScore >= 4 ? "plugs" : undefined,
    signals.noiseLevel === "quiet" ? "quiet" : undefined,
    signals.callFriendly ? "calls" : undefined,
    signals.seatingScore >= 4 ? "seating" : undefined,
    area.toLowerCase(),
  ].filter((tag): tag is string => Boolean(tag));

  return Array.from(new Set(tags)).slice(0, 4);
}

export function googleCafeId(placeId: string) {
  return `google_${Buffer.from(placeId).toString("base64url")}`;
}

export function decodeGoogleCafeId(id: string) {
  if (!id.startsWith("google_")) return null;
  try {
    return Buffer.from(id.slice("google_".length), "base64url").toString("utf8");
  } catch {
    return null;
  }
}

export function googlePlaceToCafe(place: GoogleCafePlace, fallbackArea?: string): Cafe | null {
  if (
    !place.id ||
    place.location?.latitude === undefined ||
    place.location.longitude === undefined
  ) return null;

  const area = nearestArea(place, fallbackArea);
  const name = textOf(place.displayName) ?? "London cafe";
  const signals = workSignalsFromPlace(place);
  const openNow = place.currentOpeningHours?.openNow ?? place.regularOpeningHours?.openNow;
  const openHint = place.currentOpeningHours?.openNow === false ? "Check hours before going" : "Best before peak periods";
  const recommendedStay = signals.plugScore >= 4 && signals.seatingScore >= 4
    ? "2-3 hours"
    : signals.seatingScore >= 4
      ? "2 hours"
      : "1-2 hours";

  return {
    id: googleCafeId(place.id),
    name,
    area,
    address: place.shortFormattedAddress ?? place.formattedAddress ?? area,
    lat: place.location.latitude,
    lng: place.location.longitude,
    rating: place.rating ?? 4.1,
    reviewCount: place.userRatingCount ?? 0,
    imageUrl: placePhotoUrl(place),
    imageAlt: `${name} from Google Places`,
    ...signals,
    bestTime: openHint,
    recommendedStay,
    bestFor: bestFor(place, area, signals),
    workSummary:
      `${name} is a Google Places cafe match in ${area}. Work scores are cautious estimates from Maps rating, popularity, opening status, and cafe metadata until review analysis is opened.`,
    openNow,
    source: "google",
    googlePlaceId: place.id,
    googleMapsUri: place.googleMapsUri,
  };
}

async function searchNearbyCafes(point: (typeof londonDiscoveryPoints)[number]) {
  const payload = await fetchGoogleJson<NearbySearchResponse>(
    "https://places.googleapis.com/v1/places:searchNearby",
    {
      method: "POST",
      body: JSON.stringify({
        includedTypes: ["cafe"],
        excludedTypes: ["restaurant", "bar", "pub", "night_club", "meal_takeaway", "meal_delivery"],
        maxResultCount: 20,
        rankPreference: "POPULARITY",
        languageCode: "en",
        regionCode: "GB",
        locationRestriction: {
          circle: {
            center: { latitude: point.lat, longitude: point.lng },
            radius: point.radius,
          },
        },
      }),
    },
    DISCOVERY_FIELD_MASK,
  );

  return (payload?.places ?? [])
    .filter(isLikelyWorkCafe)
    .map((place) => googlePlaceToCafe(place, point.area))
    .filter((cafe): cafe is Cafe => Boolean(cafe));
}

async function discoverGoogleCafes() {
  const batches = await Promise.all(londonDiscoveryPoints.map((point) => searchNearbyCafes(point)));
  const byPlaceId = new Map<string, Cafe>();

  for (const cafe of batches.flat()) {
    const key = cafe.googlePlaceId ?? cafe.id;
    const current = byPlaceId.get(key);
    if (!current || cafe.reviewCount > current.reviewCount) {
      byPlaceId.set(key, cafe);
    }
  }

  return Array.from(byPlaceId.values())
    .sort((a, b) => {
      const scoreDelta = calculateWorkScore(b) - calculateWorkScore(a);
      if (scoreDelta !== 0) return scoreDelta;
      const ratingDelta = b.rating - a.rating;
      if (Math.abs(ratingDelta) > 0.1) return ratingDelta;
      return b.reviewCount - a.reviewCount;
    })
    .slice(0, 180);
}

export async function getExpandedCafes() {
  if (!expandedCafeCache) {
    expandedCafeCache = discoverGoogleCafes()
      .then((googleCafes) => {
        const seedIds = new Set(seedCafes.map((cafe) => cafe.id));
        return [
          ...seedCafes,
          ...googleCafes.filter((cafe) => !seedIds.has(cafe.id)),
        ];
      })
      .catch(() => seedCafes);
  }

  return expandedCafeCache;
}

export async function fetchGoogleCafePlaceDetails(placeId: string) {
  return fetchGoogleJson<GoogleCafePlace>(
    `https://places.googleapis.com/v1/places/${placeId}`,
    { method: "GET" },
    DETAILS_FIELD_MASK,
  );
}
