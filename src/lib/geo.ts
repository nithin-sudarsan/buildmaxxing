import type { Cafe, UserLocation } from "./types";

export function distanceKm(
  origin: UserLocation,
  target: Pick<Cafe, "lat" | "lng">,
) {
  const earthRadiusKm = 6371;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latA = toRadians(origin.lat);
  const latB = toRadians(target.lat);
  const deltaLat = toRadians(target.lat - origin.lat);
  const deltaLng = toRadians(target.lng - origin.lng);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLng / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function formatDistance(km?: number) {
  if (km === undefined) return undefined;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

export function normalizeUserLocation(value: unknown): UserLocation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<UserLocation>;
  const lat = Number(candidate.lat);
  const lng = Number(candidate.lng);
  const accuracy = Number(candidate.accuracy);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;

  return {
    lat,
    lng,
    ...(Number.isFinite(accuracy) && accuracy >= 0 ? { accuracy } : {}),
  };
}
