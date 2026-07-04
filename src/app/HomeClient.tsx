"use client";

import Image from "next/image";
import Link from "next/link";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import {
  ArrowRight,
  ArrowSquareOut,
  BatteryCharging,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChatCircleText,
  Clock,
  Crosshair,
  Funnel,
  Lightning,
  MagnifyingGlass,
  Minus,
  Moon,
  NavigationArrow,
  Plus,
  Star,
  SpinnerGap,
  Sun,
  WifiHigh,
  X,
} from "@phosphor-icons/react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CafePlaceModal } from "@/components/CafePlaceModal";
import { FeedbackModal } from "@/components/FeedbackModal";
import { cafes as seedCafes } from "@/lib/cafes";
import { distanceKm, formatDistance } from "@/lib/geo";
import { calculateWorkScore, formatNoise, getWorkScoreLabel } from "@/lib/scoring";
import type { Cafe, ConciergeResponse, UserLocation, WorkSessionPlan } from "@/lib/types";

type Filters = {
  laptop: boolean;
  wifi: boolean;
  plugs: boolean;
  quiet: boolean;
  calls: boolean;
};

type MapStatus = "missing-key" | "loading" | "ready" | "error";
type LocationStatus = "idle" | "requesting" | "ready" | "denied" | "unsupported" | "error";
type AppTheme = "dark" | "light";
type ConciergeMode = "search" | "session_plan" | "rebook";
type ConciergeThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  followUpQuestion?: string;
};

const defaultFilters: Filters = {
  laptop: false,
  wifi: false,
  plugs: false,
  quiet: false,
  calls: false,
};

const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

declare global {
  interface Window {
    __buildMaxxingGoogleMapsLoaderConfigured?: boolean;
  }
}

const londonCenter = { lat: 51.515, lng: -0.095 };

const darkMapStyles: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#1b1d1c" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1b1d1c" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#333835" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#202522" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2f3431" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#171918" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#373d39" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#252c2a" }] },
];

const lightMapStyles: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#f3efe7" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#6d6258" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#fbf8f2" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#d5cab9" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#eee8dc" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#fffaf2" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#d8cdbe" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#eadfcf" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#cadbd7" }] },
];

const themeStorageKey = "buildmaxxing-theme";

function nearbyWorkRank(cafe: Cafe, userLocation: UserLocation) {
  const distance = distanceKm(userLocation, cafe);
  const proximityBoost = distance <= 0.75
    ? 18
    : distance <= 1.5
      ? 12
      : distance <= 3
        ? 6
        : distance <= 5
          ? 1
          : -Math.min(22, distance * 2);

  return calculateWorkScore(cafe) + proximityBoost;
}

function filterCafes(cafePool: Cafe[], query: string, filters: Filters, userLocation?: UserLocation | null) {
  const normalized = query.trim().toLowerCase();

  return cafePool
    .filter((cafe) => {
      const haystack = [
        cafe.name,
        cafe.area,
        cafe.address,
        cafe.bestFor.join(" "),
        cafe.workSummary,
      ]
        .join(" ")
        .toLowerCase();

      if (normalized && !haystack.includes(normalized)) return false;
      if (filters.laptop && !cafe.laptopFriendly) return false;
      if (filters.wifi && cafe.wifiScore < 4) return false;
      if (filters.plugs && cafe.plugScore < 4) return false;
      if (filters.quiet && !["quiet", "moderate"].includes(cafe.noiseLevel)) return false;
      if (filters.calls && !cafe.callFriendly) return false;
      return true;
    })
    .sort((a, b) => {
      if (userLocation) {
        const rankDelta = nearbyWorkRank(b, userLocation) - nearbyWorkRank(a, userLocation);
        if (rankDelta !== 0) return rankDelta;
        return distanceKm(userLocation, a) - distanceKm(userLocation, b);
      }
      return calculateWorkScore(b) - calculateWorkScore(a);
    });
}

function pinColor(cafe: Cafe) {
  const score = calculateWorkScore(cafe);
  if (score >= 88) return "#72d900";
  if (score >= 74) return "#b7c800";
  return "#e46f52";
}

function googleDirectionsUrl(cafe: Cafe, userLocation?: UserLocation | null) {
  const params = new URLSearchParams({
    api: "1",
    destination: `${cafe.lat},${cafe.lng}`,
    travelmode: "walking",
  });
  if (userLocation) {
    params.set("origin", `${userLocation.lat},${userLocation.lng}`);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function openStatusLabel(cafe: Cafe) {
  if (cafe.openNow === true) return "Open now";
  if (cafe.openNow === false) return "Closed now";
  return "Hours unknown";
}

function openStatusTone(cafe: Cafe) {
  if (cafe.openNow === true) return "text-emerald-200";
  if (cafe.openNow === false) return "text-amber-200";
  return "text-zinc-500";
}

function projectCafe(cafe: Cafe) {
  const bounds = {
    minLat: 51.455,
    maxLat: 51.55,
    minLng: -0.23,
    maxLng: 0.005,
  };

  const x = ((cafe.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100;
  const y = ((bounds.maxLat - cafe.lat) / (bounds.maxLat - bounds.minLat)) * 100;

  return {
    left: `${Math.max(7, Math.min(93, x))}%`,
    top: `${Math.max(8, Math.min(92, y))}%`,
  };
}

function escapeHtml(value: string | number) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function cafeMarkerTitle(cafe: Cafe) {
  return `${cafe.name} - ${openStatusLabel(cafe)} - WiFi ${cafe.wifiScore}/5 - Plugs ${cafe.plugScore}/5 - ${formatNoise(cafe.noiseLevel)}`;
}

function cafeMarkerIcon(cafe: Cafe, selected: boolean): google.maps.Icon {
  const width = selected ? 34 : 26;
  const height = selected ? 44 : 34;
  const color = pinColor(cafe);
  const border = selected ? "#f8fff0" : "#101411";
  const borderWidth = selected ? 3 : 2;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 34 44">
      <path d="M17 42C17 42 31 25.4 31 15.8C31 7.9 24.7 2 17 2C9.3 2 3 7.9 3 15.8C3 25.4 17 42 17 42Z" fill="${color}" stroke="${border}" stroke-width="${borderWidth}"/>
      <circle cx="17" cy="15.8" r="4.5" fill="#f8fff0"/>
    </svg>
  `.trim();

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(width, height),
    anchor: new google.maps.Point(width / 2, height),
  };
}

function cafeInfoContent(cafe: Cafe, theme: AppTheme) {
  const shell = theme === "dark"
    ? {
        background: "#19120e",
        border: "rgba(255,255,255,.16)",
        text: "#f4f4f5",
        muted: "#a1a1aa",
        body: "#d4d4d8",
        shadow: "rgba(0,0,0,.42)",
      }
    : {
        background: "#fffaf2",
        border: "rgba(61,48,39,.16)",
        text: "#241c17",
        muted: "#6c625c",
        body: "#4d443e",
        shadow: "rgba(60,48,37,.18)",
      };

  return `
    <div style="min-width:210px;max-width:240px;background:${shell.background};color:${shell.text};padding:12px;border:1px solid ${shell.border};box-shadow:0 18px 58px ${shell.shadow};">
      <div style="font-weight:700;font-size:13px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(cafe.name)}</div>
      <div style="margin-top:4px;font-family:monospace;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${shell.muted};">${escapeHtml(cafe.area)} - ${calculateWorkScore(cafe)} score</div>
      <div style="margin-top:8px;font-size:12px;line-height:1.5;color:${shell.body};">${escapeHtml(openStatusLabel(cafe))} - WiFi ${cafe.wifiScore}/5 - Plugs ${cafe.plugScore}/5 - ${escapeHtml(formatNoise(cafe.noiseLevel))}</div>
    </div>
  `;
}

function createCafeMarker({
  cafe,
  infoWindow,
  map,
  selected,
  theme,
  onSelect,
}: {
  cafe: Cafe;
  infoWindow: google.maps.InfoWindow;
  map: google.maps.Map;
  selected: boolean;
  theme: AppTheme;
  onSelect: () => void;
}) {
  const marker = new google.maps.Marker({
    icon: cafeMarkerIcon(cafe, selected),
    map,
    optimized: true,
    position: { lat: cafe.lat, lng: cafe.lng },
    title: cafeMarkerTitle(cafe),
    zIndex: selected ? 1000 : calculateWorkScore(cafe),
  });

  marker.addListener("click", onSelect);
  marker.addListener("mouseover", () => {
    infoWindow.setContent(cafeInfoContent(cafe, theme));
    infoWindow.open({ anchor: marker, map, shouldFocus: false });
  });
  marker.addListener("mouseout", () => infoWindow.close());

  return marker;
}

function updateCafeMarker(marker: google.maps.Marker, cafe: Cafe, selected: boolean) {
  marker.setIcon(cafeMarkerIcon(cafe, selected));
  marker.setTitle(cafeMarkerTitle(cafe));
  marker.setZIndex(selected ? 1000 : calculateWorkScore(cafe));
}

function createUserLocationOverlay({
  OverlayView,
  location,
  map,
}: {
  OverlayView: typeof google.maps.OverlayView;
  location: UserLocation;
  map: google.maps.Map;
}) {
  class UserLocationOverlay extends OverlayView {
    private element: HTMLDivElement | null = null;

    onAdd() {
      const element = document.createElement("div");
      element.setAttribute("aria-label", "Your current location");
      element.style.position = "absolute";
      element.style.width = "24px";
      element.style.height = "24px";
      element.style.borderRadius = "999px";
      element.style.background = "#5eead4";
      element.style.border = "4px solid #0f1411";
      element.style.boxShadow = "0 0 0 12px rgba(94,234,212,0.18), 0 0 32px rgba(94,234,212,0.65)";
      element.style.zIndex = "1400";
      this.element = element;
      this.getPanes()?.overlayLayer.appendChild(element);
    }

    draw() {
      if (!this.element) return;
      const point = this.getProjection().fromLatLngToDivPixel({
        lat: location.lat,
        lng: location.lng,
      });
      if (!point) return;
      this.element.style.left = `${point.x}px`;
      this.element.style.top = `${point.y}px`;
      this.element.style.transform = "translate(-50%, -50%)";
    }

    onRemove() {
      this.element?.remove();
      this.element = null;
    }
  }

  const overlay = new UserLocationOverlay();
  overlay.setMap(map);
  return overlay;
}

function readDetailCafeIdFromUrl() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("cafe") ?? params.get("details");
}

function readFeedbackCafeIdFromUrl() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("feedback")) return null;
  return params.get("feedback") ?? "";
}

function subscribeToUrlChanges(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("buildmaxxing:urlchange", callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("buildmaxxing:urlchange", callback);
  };
}

function updateUrl(url: string | URL) {
  window.history.pushState(null, "", url);
  window.dispatchEvent(new Event("buildmaxxing:urlchange"));
}

function threadMessageId() {
  return globalThis.crypto?.randomUUID?.() ?? `message-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function useDetailCafeIdFromUrl() {
  return useSyncExternalStore(subscribeToUrlChanges, readDetailCafeIdFromUrl, () => null);
}

function useFeedbackCafeIdFromUrl() {
  return useSyncExternalStore(subscribeToUrlChanges, readFeedbackCafeIdFromUrl, () => null);
}

export function HomeClient() {
  const urlDetailCafeId = useDetailCafeIdFromUrl();
  const urlFeedbackCafeId = useFeedbackCafeIdFromUrl();
  const [availableCafes, setAvailableCafes] = useState<Cafe[]>(seedCafes);
  const [cafesStatus, setCafesStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [query, setQuery] = useState("");
  const [conciergeMessage, setConciergeMessage] = useState("");
  const [conciergeThread, setConciergeThread] = useState<ConciergeThreadMessage[]>([]);
  const [conciergeResponse, setConciergeResponse] = useState<ConciergeResponse | null>(null);
  const [conciergeLoading, setConciergeLoading] = useState(false);
  const [conciergeError, setConciergeError] = useState<string | null>(null);
  const [conciergePanelOpen, setConciergePanelOpen] = useState(false);
  const [activeSessionPlan, setActiveSessionPlan] = useState<WorkSessionPlan | null>(null);
  const [activeFollowUpQuestion, setActiveFollowUpQuestion] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [filters, setFilters] = useState(defaultFilters);
  const [selectedId, setSelectedId] = useState(seedCafes[0].id);
  const [expandedId, setExpandedId] = useState(seedCafes[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [theme, setTheme] = useState<AppTheme>("dark");
  const [mapStatus, setMapStatus] = useState<MapStatus>(
    googleMapsApiKey ? "loading" : "missing-key",
  );
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const mapsLibraryRef = useRef<google.maps.MapsLibrary | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const userMarkerRef = useRef<google.maps.OverlayView | null>(null);
  const userLocationRef = useRef<UserLocation | null>(null);
  const cafeSearchRef = useRef({ availableCafes, filters, query });
  const conciergePromptRef = useRef<HTMLInputElement | null>(null);
  const autoLocationCheckedRef = useRef(false);

  const results = useMemo(
    () => filterCafes(availableCafes, query, filters, userLocation),
    [availableCafes, filters, query, userLocation],
  );
  const selectedCafe =
    results.find((cafe) => cafe.id === (urlDetailCafeId ?? selectedId)) ??
    availableCafes.find((cafe) => cafe.id === (urlDetailCafeId ?? selectedId)) ??
    results[0] ??
    seedCafes[0];
  const detailCafe = availableCafes.find((cafe) => cafe.id === urlDetailCafeId) ?? null;
  const feedbackCafe =
    urlFeedbackCafeId === null
      ? null
      : availableCafes.find((cafe) => cafe.id === urlFeedbackCafeId) ?? selectedCafe;
  const conciergeMatches = useMemo(() => {
    if (!conciergeResponse) return [];
    return conciergeResponse.recommendations
      .map((recommendation) => ({
        recommendation,
        cafe: availableCafes.find((cafe) => cafe.id === recommendation.cafeId),
      }))
      .filter((item): item is { recommendation: NonNullable<typeof item.recommendation>; cafe: Cafe } =>
        Boolean(item.cafe),
      );
  }, [availableCafes, conciergeResponse]);
  const displayedSessionPlan = conciergeResponse?.sessionPlan ?? activeSessionPlan;

  useEffect(() => {
    cafeSearchRef.current = { availableCafes, filters, query };
  }, [availableCafes, filters, query]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const storedTheme = window.localStorage.getItem(themeStorageKey);
      if (storedTheme === "dark" || storedTheme === "light") {
        setTheme(storedTheme);
        return;
      }

      if (window.matchMedia("(prefers-color-scheme: light)").matches) {
        setTheme("light");
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.buildmaxxingTheme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  const applyUserLocation = useCallback((nextLocation: UserLocation) => {
    userLocationRef.current = nextLocation;
    setUserLocation(nextLocation);
    setLocationStatus("ready");
    setLocationMessage("Near me is on. Results are ranked from your current location.");

    const current = cafeSearchRef.current;
    const nearbyResults = filterCafes(
      current.availableCafes,
      current.query,
      current.filters,
      nextLocation,
    );
    const firstNearby = nearbyResults[0];
    if (firstNearby) {
      setSelectedId(firstNearby.id);
      setExpandedId(firstNearby.id);
    }

    const map = mapRef.current;
    if (map) {
      map.panTo({ lat: nextLocation.lat, lng: nextLocation.lng });
      if ((map.getZoom() ?? 12) < 13) map.setZoom(13);
    }
  }, []);

  const requestUserLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setLocationStatus("unsupported");
      setLocationMessage("Location is not available in this browser.");
      return;
    }

    setLocationStatus("requesting");
    setLocationMessage(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        applyUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setLocationStatus("denied");
          setLocationMessage("Location permission was denied.");
        } else {
          setLocationStatus("error");
          setLocationMessage("Could not get your current location.");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 9000,
        maximumAge: 1000 * 60 * 5,
      },
    );
  }, [applyUserLocation]);

  useEffect(() => {
    if (
      autoLocationCheckedRef.current ||
      typeof navigator === "undefined" ||
      !("permissions" in navigator) ||
      !("geolocation" in navigator)
    ) {
      return;
    }

    autoLocationCheckedRef.current = true;
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((permission) => {
        if (cancelled || permission.state !== "granted") return;
        requestUserLocation();
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [requestUserLocation]);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/cafes", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Cafe discovery failed");
        return response.json() as Promise<{ cafes?: Cafe[] }>;
      })
      .then((payload) => {
        const nextCafes = Array.isArray(payload.cafes) && payload.cafes.length > 0
          ? payload.cafes
          : seedCafes;
        setAvailableCafes(nextCafes);
        setCafesStatus(nextCafes.length > seedCafes.length ? "ready" : "fallback");
        const currentLocation = userLocationRef.current;
        if (currentLocation) {
          const nearbyResults = filterCafes(nextCafes, "", defaultFilters, currentLocation);
          const firstNearby = nearbyResults[0];
          if (firstNearby) {
            setSelectedId(firstNearby.id);
            setExpandedId(firstNearby.id);
          }
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setAvailableCafes(seedCafes);
        setCafesStatus("fallback");
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!googleMapsApiKey || !mapElementRef.current || mapRef.current) return;

    let cancelled = false;
    if (!window.__buildMaxxingGoogleMapsLoaderConfigured) {
      setOptions({
        key: googleMapsApiKey,
        v: "weekly",
      });
      window.__buildMaxxingGoogleMapsLoaderConfigured = true;
    }

    importLibrary("maps")
      .then((library) => {
        if (cancelled || !mapElementRef.current) return;
        const mapsLibrary = library as google.maps.MapsLibrary;
        mapsLibraryRef.current = mapsLibrary;
        const { Map } = mapsLibrary;
        mapRef.current = new Map(mapElementRef.current, {
          center: londonCenter,
          zoom: 12,
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: "greedy",
          styles: darkMapStyles,
        });
        setMapStatus("ready");
      })
      .catch(() => setMapStatus("error"));

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mapStatus !== "ready") return;
    mapRef.current?.setOptions({
      styles: theme === "dark" ? darkMapStyles : lightMapStyles,
    });
  }, [mapStatus, theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (mapStatus !== "ready" || !map) return;

    const infoWindow = infoWindowRef.current ?? new google.maps.InfoWindow({ disableAutoPan: true });
    infoWindowRef.current = infoWindow;
    markersRef.current.forEach((marker) => {
      google.maps.event.clearInstanceListeners(marker);
      marker.setMap(null);
    });

    const nextMarkers = new Map<string, google.maps.Marker>();
    results.forEach((cafe) => {
      const marker = createCafeMarker({
        cafe,
        infoWindow,
        map,
        selected: false,
        theme,
        onSelect: () => {
          setSelectedId(cafe.id);
          setExpandedId(cafe.id);
          setSidebarOpen(true);
        },
      });
      nextMarkers.set(cafe.id, marker);
    });
    markersRef.current = nextMarkers;

    return () => {
      nextMarkers.forEach((marker) => {
        google.maps.event.clearInstanceListeners(marker);
        marker.setMap(null);
      });
      if (markersRef.current === nextMarkers) {
        markersRef.current = new Map();
      }
    };
  }, [results, mapStatus, theme]);

  useEffect(() => {
    if (mapStatus !== "ready") return;
    const cafeById = new Map(results.map((cafe) => [cafe.id, cafe]));
    markersRef.current.forEach((marker, id) => {
      const cafe = cafeById.get(id);
      if (!cafe) return;
      updateCafeMarker(marker, cafe, id === selectedCafe.id);
    });
  }, [results, selectedCafe.id, mapStatus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedCafe) return;
    map.panTo({ lat: selectedCafe.lat, lng: selectedCafe.lng });
    if ((map.getZoom() ?? 12) < 13) map.setZoom(13);
  }, [selectedCafe]);

  useEffect(() => {
    const mapsLibrary = mapsLibraryRef.current;
    const map = mapRef.current;
    userMarkerRef.current?.setMap(null);
    userMarkerRef.current = null;
    if (mapStatus !== "ready" || !mapsLibrary || !map || !userLocation) return;

    const marker = createUserLocationOverlay({
      OverlayView: mapsLibrary.OverlayView,
      location: userLocation,
      map,
    });
    userMarkerRef.current = marker;

    return () => {
      marker.setMap(null);
      if (userMarkerRef.current === marker) {
        userMarkerRef.current = null;
      }
    };
  }, [mapStatus, userLocation]);

  function toggleFilter(key: keyof Filters) {
    setFilters((current) => ({ ...current, [key]: !current[key] }));
  }

  function selectCafe(cafe: Cafe) {
    setSelectedId(cafe.id);
    setExpandedId((current) => (current === cafe.id ? "" : cafe.id));
  }

  function openCafeDetails(cafe: Cafe) {
    setSelectedId(cafe.id);
    setExpandedId(cafe.id);
    const url = new URL(window.location.href);
    url.searchParams.delete("feedback");
    url.searchParams.set("cafe", cafe.id);
    updateUrl(url);
  }

  function closeCafeDetails() {
    const url = new URL(window.location.href);
    if (url.searchParams.has("cafe") || url.searchParams.has("details")) {
      url.searchParams.delete("cafe");
      url.searchParams.delete("details");
      updateUrl(url.pathname + url.search);
    }
  }

  function openFeedback(cafe = selectedCafe) {
    setSelectedId(cafe.id);
    setExpandedId(cafe.id);
    const url = new URL(window.location.href);
    url.searchParams.delete("cafe");
    url.searchParams.delete("details");
    url.searchParams.set("feedback", cafe.id);
    updateUrl(url);
  }

  function closeFeedback() {
    const url = new URL(window.location.href);
    if (url.searchParams.has("feedback")) {
      url.searchParams.delete("feedback");
      updateUrl(url.pathname + url.search);
    }
  }

  async function runConcierge(messageOverride?: string, mode: ConciergeMode = "session_plan") {
    const visibleMessage = messageOverride?.trim() ?? conciergeMessage.trim();
    if (!visibleMessage) {
      setConciergePanelOpen(true);
      setConciergeError(null);
      window.requestAnimationFrame(() => conciergePromptRef.current?.focus());
      return;
    }

    const followUpQuestion = !messageOverride ? activeFollowUpQuestion : null;
    const userThreadMessage: ConciergeThreadMessage = {
      id: threadMessageId(),
      role: "user",
      content: visibleMessage,
      ...(followUpQuestion ? { followUpQuestion } : {}),
    };
    const nextThread = [...conciergeThread, userThreadMessage].slice(-12);

    setConciergeThread(nextThread);
    setConciergeMessage("");
    setActiveFollowUpQuestion(null);
    setConciergePanelOpen(true);
    setConciergeLoading(true);
    setConciergeError(null);

    try {
      const response = await fetch("/api/agent/concierge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: visibleMessage,
          followUpQuestion,
          conversationHistory: nextThread.map(({ role, content, followUpQuestion: question }) => ({
            role,
            content,
            ...(question ? { followUpQuestion: question } : {}),
          })),
          location: userLocation,
          currentCafeId: selectedCafe.id,
          mode,
          activeSessionPlan,
        }),
      });
      if (!response.ok) throw new Error("Concierge request failed");
      const data = (await response.json()) as ConciergeResponse;
      setConciergeResponse(data);
      setConciergeThread((current) => [
        ...current,
        {
          id: threadMessageId(),
          role: "assistant" as const,
          content: data.reply,
        },
      ].slice(-16));
      if (data.sessionPlan) {
        setActiveSessionPlan(data.sessionPlan);
      }
      const firstMatch = data.recommendations
        .map((recommendation) => availableCafes.find((cafe) => cafe.id === recommendation.cafeId))
        .find((cafe): cafe is Cafe => Boolean(cafe));
      if (firstMatch) {
        setSelectedId(firstMatch.id);
        setExpandedId(firstMatch.id);
        setSidebarOpen(true);
      }
    } catch {
      const errorMessage = "The concierge could not continue the thread right now.";
      setConciergeError(errorMessage);
      setConciergeThread((current) => [
        ...current,
        {
          id: threadMessageId(),
          role: "assistant" as const,
          content: errorMessage,
        },
      ].slice(-16));
    } finally {
      setConciergeLoading(false);
    }
  }

  async function submitConcierge(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    await runConcierge();
  }

  function openSessionPlanner() {
    setConciergeMessage("");
    setConciergeThread([]);
    setConciergeResponse(null);
    setActiveSessionPlan(null);
    setConciergePanelOpen(true);
    setConciergeError(null);
    setActiveFollowUpQuestion(null);
    window.requestAnimationFrame(() => conciergePromptRef.current?.focus());
  }

  function answerFollowUpQuestion(question: string) {
    setConciergePanelOpen(true);
    setConciergeMessage("");
    setActiveFollowUpQuestion(question);
    window.requestAnimationFrame(() => conciergePromptRef.current?.focus());
  }

  function rebookSession(reason: string) {
    const planContext = activeSessionPlan
      ? ` My current plan is: ${activeSessionPlan.headline}.`
      : "";
    void runConcierge(
      `I'm at ${selectedCafe.name}. ${reason}${planContext} Find me my next spot for the remaining work session.`,
      "rebook",
    );
  }

  function zoomBy(delta: number) {
    const map = mapRef.current;
    if (!map) return;
    map.setZoom((map.getZoom() ?? 12) + delta);
  }

  function recenter() {
    const map = mapRef.current;
    if (!map) return;
    map.panTo({ lat: selectedCafe.lat, lng: selectedCafe.lng });
    map.setZoom(13);
  }

  return (
    <main data-theme={theme} className="build-app fixed inset-0 z-30 overflow-hidden bg-[#121412] text-zinc-50">
      <div className="absolute inset-0">
        <div ref={mapElementRef} className="h-full w-full" />
        {mapStatus !== "ready" ? (
          <FallbackMap
            cafes={results}
            selectedCafe={selectedCafe}
            status={mapStatus}
            onSelect={(cafe) => {
              setSelectedId(cafe.id);
              setExpandedId(cafe.id);
              setSidebarOpen(true);
            }}
          />
        ) : null}
        <div className="map-vignette pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(0,0,0,0)_0,rgba(0,0,0,0.18)_45%,rgba(0,0,0,0.42)_100%)]" />
      </div>

      <aside
        className={`absolute bottom-0 left-0 top-0 z-20 border-r border-white/10 bg-[#191612]/94 shadow-[28px_0_80px_rgba(0,0,0,0.38)] backdrop-blur-xl transition-[width,transform] duration-300 ${
          sidebarOpen ? "w-full max-w-[430px]" : "w-[76px]"
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-20 items-center justify-between border-b border-white/10 px-5">
            <Link
              href="/"
              className={`font-serif text-2xl font-semibold tracking-tight text-zinc-50 transition ${
                sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              BuildMaxxing
            </Link>
            <button
              type="button"
              onClick={() => setSidebarOpen((current) => !current)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-none border border-white/15 bg-[#251f1a] text-zinc-200 transition hover:border-emerald-300 hover:text-emerald-200 active:translate-y-px"
              aria-label={sidebarOpen ? "Collapse cafe list" : "Expand cafe list"}
            >
              {sidebarOpen ? <CaretLeft size={18} weight="bold" /> : <CaretRight size={18} weight="bold" />}
            </button>
          </div>

          {sidebarOpen ? (
            <>
              <div className="border-b border-white/10 p-5">
                <label htmlFor="map-search" className="sr-only">
                  Search cafes
                </label>
                <div className="relative">
                  <MagnifyingGlass
                    size={19}
                    weight="bold"
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500"
                  />
                  <input
                    id="map-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={`Search ${availableCafes.length} cafes...`}
                    className="h-12 w-full rounded-none border border-white/12 bg-[#13100d] pl-12 pr-4 text-sm font-medium text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-emerald-300 focus:ring-4 focus:ring-emerald-300/10"
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <SidebarFilter active={filters.wifi} onClick={() => toggleFilter("wifi")}>
                    Good WiFi
                  </SidebarFilter>
                  <SidebarFilter active={filters.plugs} onClick={() => toggleFilter("plugs")}>
                    Plugs
                  </SidebarFilter>
                  <SidebarFilter active={filters.quiet} onClick={() => toggleFilter("quiet")}>
                    Quiet
                  </SidebarFilter>
                  <SidebarFilter active={filters.calls} onClick={() => toggleFilter("calls")}>
                    Calls
                  </SidebarFilter>
                  <SidebarFilter active={filters.laptop} onClick={() => toggleFilter("laptop")}>
                    Laptop
                  </SidebarFilter>
                </div>

                <div className="mt-4 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    {results.length} matches
                  </span>
                  <span>
                    {userLocation
                      ? "near me active"
                      : cafesStatus === "loading"
                        ? "loading London"
                        : cafesStatus === "ready"
                          ? `${availableCafes.length} loaded`
                          : "seed list"}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <Funnel size={15} weight="bold" />
                    {userLocation ? "Proximity rank" : "Work score"}
                  </span>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {results.length ? (
                  results.map((cafe) => (
	                    <CafeListItem
	                      key={cafe.id}
	                      cafe={cafe}
	                      selected={cafe.id === selectedCafe.id}
	                      expanded={cafe.id === (urlDetailCafeId ?? expandedId)}
	                      distanceLabel={userLocation ? formatDistance(distanceKm(userLocation, cafe)) : undefined}
	                      onSelect={() => selectCafe(cafe)}
	                      onOpenDetails={() => openCafeDetails(cafe)}
	                      onOpenFeedback={() => openFeedback(cafe)}
	                    />
                  ))
                ) : (
	                  <div className="p-6 text-sm leading-6 text-zinc-400">
	                    No matching cafes. Clear a filter or ask the concierge.
	                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center gap-3 border-t border-white/10 py-5">
              {results.slice(0, 7).map((cafe) => (
                <button
                  key={cafe.id}
                  type="button"
                  onClick={() => {
                    setSidebarOpen(true);
                    selectCafe(cafe);
                  }}
                  className={`h-9 w-9 rounded-full text-xs font-bold transition active:translate-y-px ${
                    cafe.id === selectedCafe.id
                      ? "bg-emerald-300 text-zinc-950"
                      : "bg-[#2a241f] text-zinc-200 hover:bg-[#373028]"
                  }`}
                  aria-label={`Open ${cafe.name}`}
                >
                  {cafe.name.slice(0, 1)}
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <div
        className={`absolute top-28 z-10 hidden flex-col gap-3 transition-[left] duration-300 md:flex ${
          sidebarOpen ? "left-[452px]" : "left-[100px]"
        }`}
      >
        <button
          type="button"
          onClick={() => zoomBy(1)}
          className="inline-flex h-12 w-12 items-center justify-center border border-white/12 bg-[#241f1a]/90 text-zinc-100 backdrop-blur transition hover:border-emerald-300 active:translate-y-px"
          aria-label="Zoom in"
        >
          <Plus size={18} weight="bold" />
        </button>
        <button
          type="button"
          onClick={() => zoomBy(-1)}
          className="inline-flex h-12 w-12 items-center justify-center border border-white/12 bg-[#241f1a]/90 text-zinc-100 backdrop-blur transition hover:border-emerald-300 active:translate-y-px"
          aria-label="Zoom out"
        >
          <Minus size={18} weight="bold" />
        </button>
        <button
          type="button"
          onClick={recenter}
          className="inline-flex h-12 w-12 items-center justify-center border border-white/12 bg-[#241f1a]/90 text-zinc-100 backdrop-blur transition hover:border-emerald-300 active:translate-y-px"
          aria-label="Center selected cafe"
        >
          <Crosshair size={18} weight="bold" />
        </button>
      </div>

      <div className="absolute right-5 top-5 z-10 hidden items-center gap-2 border border-white/12 bg-[#241f1a]/90 p-2 text-xs font-bold uppercase tracking-[0.16em] text-zinc-400 backdrop-blur md:flex">
        <button
          type="button"
          onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
          className="inline-flex h-9 w-9 items-center justify-center border border-white/12 bg-[#0f0c09] text-zinc-100 transition hover:border-emerald-300 active:translate-y-px"
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
        >
          {theme === "dark" ? <Sun size={17} weight="bold" /> : <Moon size={17} weight="bold" />}
        </button>
        <span className="border-b-2 border-[#e46f52] px-3 py-2 text-zinc-100">Map</span>
        <button
          type="button"
          onClick={() => openFeedback()}
          className="px-3 py-2 transition hover:text-emerald-200"
        >
          Feedback
        </button>
      </div>

      {conciergePanelOpen ? (
        <section
          data-testid="concierge-panel"
          className="absolute bottom-3 right-3 top-24 z-30 flex w-[min(440px,calc(100vw-1.5rem))] flex-col border border-white/12 bg-[#19120e]/96 shadow-[0_24px_90px_rgba(0,0,0,0.46)] backdrop-blur-xl md:bottom-5 md:right-5"
        >
          <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
            <div>
              <p className="inline-flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.16em] text-zinc-400">
                <ChatCircleText size={16} weight="bold" className="text-emerald-200" />
                Concierge
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-zinc-500">
                {userLocation ? <span className="text-emerald-200">near you</span> : null}
                {conciergeResponse ? <span>{conciergeResponse.provider}</span> : null}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setConciergePanelOpen(false)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center border border-white/12 bg-[#241f1a] text-zinc-100 transition hover:border-emerald-300 active:translate-y-px"
              aria-label="Close concierge"
            >
              <X size={18} weight="bold" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {conciergeThread.length ? (
              <div className="grid gap-3">
                {conciergeThread.map((message) => (
                  <div
                    key={message.id}
                    className={`border p-3 text-sm leading-6 ${
                      message.role === "user"
                        ? "ml-8 border-emerald-300/20 bg-emerald-300/10 font-medium text-zinc-100"
                        : "mr-6 border-white/10 bg-[#241f1a] text-zinc-200"
                    }`}
                  >
                    {message.followUpQuestion ? (
                      <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-200">
                        Answer to: {message.followUpQuestion}
                      </p>
                    ) : null}
                    {message.content}
                  </div>
                ))}
              </div>
            ) : null}

            {conciergeThread.length === 0 && !conciergeResponse && !displayedSessionPlan && !conciergeLoading ? (
              <div className="mr-6 border border-white/10 bg-[#241f1a] p-3 text-sm leading-6 text-zinc-200">
                <p className="font-semibold text-zinc-100">What kind of work session are we planning?</p>
                <p className="mt-1 text-zinc-400">
                  Tell me your duration, call times, area, and must-haves like plugs or quiet.
                </p>
              </div>
            ) : null}

            {conciergeLoading ? (
              <p className="mt-4 inline-flex items-center gap-2 text-sm text-zinc-300">
                <SpinnerGap size={16} className="animate-spin" />
                Planning your work session
              </p>
            ) : null}

            {conciergeError ? (
              <p className="mt-4 border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
                {conciergeError}
              </p>
            ) : null}

            {displayedSessionPlan ? (
              <SessionPlanCard
                cafes={availableCafes}
                plan={displayedSessionPlan}
                userLocation={userLocation}
                onFocus={(cafe) => {
                  setSelectedId(cafe.id);
                  setExpandedId(cafe.id);
                  setSidebarOpen(true);
                }}
                onOpenDetails={openCafeDetails}
              />
            ) : null}

            {displayedSessionPlan || conciergeResponse ? (
              <SessionWatchCard
                active={Boolean(displayedSessionPlan)}
                currentCafe={selectedCafe}
                disabled={conciergeLoading}
                onRebook={rebookSession}
              />
            ) : null}

            {conciergeResponse?.followUpQuestions.length ? (
              <div className="mt-3 grid gap-2">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                  To tune this
                </p>
                {conciergeResponse.followUpQuestions.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => answerFollowUpQuestion(question)}
                    className={`border px-3 py-2 text-left text-xs font-semibold leading-5 transition active:translate-y-px ${
                      activeFollowUpQuestion === question
                        ? "border-emerald-300 bg-emerald-300 text-zinc-950"
                        : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100 hover:border-emerald-300"
                    }`}
                  >
                    {question}
                  </button>
                ))}
              </div>
            ) : null}

            {!displayedSessionPlan && conciergeMatches.length ? (
              <div className="mt-4 grid gap-3">
                {conciergeMatches.map(({ recommendation, cafe }) => (
                  <article key={cafe.id} className="border border-white/10 bg-[#15110e] p-3">
                    <div className="grid grid-cols-[auto_1fr_auto] items-start gap-3">
                      <span className="font-mono text-xs font-bold text-emerald-200">
                        #{recommendation.rank}
                      </span>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-zinc-100">
                          {cafe.name}
                        </h3>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">
                          {cafe.area}
                        </p>
                      </div>
                      <div className="text-right">
                        {recommendation.distanceKm !== undefined ? (
                          <span className="block text-xs font-semibold text-emerald-200">
                            {formatDistance(recommendation.distanceKm)}
                          </span>
                        ) : null}
                        <span className="block text-sm font-semibold text-zinc-100">
                          {recommendation.matchScore}
                        </span>
                        <span className="block font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-600">
                          match
                        </span>
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-zinc-400">
                      {recommendation.reason}
                    </p>
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      <MiniFit label="Open" value={openStatusLabel(cafe)} tone={openStatusTone(cafe)} />
                      <MiniFit label="WiFi" value={`${cafe.wifiScore}/5`} />
                      <MiniFit label="Plugs" value={`${cafe.plugScore}/5`} />
                      <MiniFit label="Noise" value={formatNoise(cafe.noiseLevel)} />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(cafe.id);
                          setExpandedId(cafe.id);
                          setSidebarOpen(true);
                        }}
                        className="inline-flex h-10 items-center justify-center border border-white/12 bg-[#0f0c09] text-xs font-semibold text-zinc-100 transition hover:border-emerald-300 active:translate-y-px"
                      >
                        Focus
                      </button>
                      <button
                        type="button"
                        onClick={() => openCafeDetails(cafe)}
                        className="inline-flex h-10 items-center justify-center border border-white/12 bg-[#0f0c09] text-xs font-semibold text-zinc-100 transition hover:border-emerald-300 active:translate-y-px"
                      >
                        Details
                      </button>
                      <a
                        href={googleDirectionsUrl(cafe, userLocation)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-10 items-center justify-center gap-1.5 bg-emerald-300 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-200 active:translate-y-px"
                      >
                        Navigate
                        <ArrowSquareOut size={14} weight="bold" />
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </div>

          <form
            className="border-t border-white/10 p-3"
            onSubmit={submitConcierge}
            autoComplete="off"
          >
            <label htmlFor="buildmaxxing-agent-panel" className="sr-only">
              Ask the concierge
            </label>
            {activeFollowUpQuestion ? (
              <div className="mb-2 border border-emerald-300/20 bg-emerald-300/10 px-3 py-2">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-200">
                  Answering
                </p>
                <p className="mt-1 text-xs font-semibold leading-5 text-zinc-200">
                  {activeFollowUpQuestion}
                </p>
              </div>
            ) : null}
            <div className="flex items-center gap-2 border border-white/12 bg-[#0f0c09] p-2">
              <button
                type="button"
                onClick={requestUserLocation}
                disabled={locationStatus === "requesting"}
                className={`inline-flex h-11 shrink-0 items-center justify-center gap-2 border px-3 text-sm font-semibold transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-70 ${
                  locationStatus === "ready"
                    ? "border-emerald-300 bg-emerald-300 text-zinc-950"
                    : "border-white/12 bg-[#241f1a] text-zinc-100 hover:border-emerald-300"
                }`}
                aria-label={locationStatus === "ready" ? "Refresh current location" : "Use current location"}
              >
                {locationStatus === "requesting" ? (
                  <SpinnerGap size={17} className="animate-spin" />
                ) : (
                  <NavigationArrow size={17} weight={locationStatus === "ready" ? "fill" : "bold"} />
                )}
                <span className="hidden sm:inline">
                  {locationStatus === "ready" ? "Near me" : "Near me"}
                </span>
              </button>
              <input
                ref={conciergePromptRef}
                id="buildmaxxing-agent-panel"
                name="buildmaxxing-agent-panel-draft"
                value={conciergeMessage}
                onChange={(event) => setConciergeMessage(event.target.value)}
                placeholder={activeFollowUpQuestion ? "Type your answer..." : "Add time, task, calls, or walking limit..."}
                autoComplete="off"
                aria-autocomplete="none"
                className="h-11 min-w-0 flex-1 bg-transparent px-2 text-sm font-medium text-zinc-100 outline-none placeholder:text-zinc-500"
              />
              <button
                type="submit"
                disabled={conciergeLoading}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center bg-[#e46f52] text-zinc-950 transition hover:bg-[#f08a6e] active:translate-y-px"
                aria-label="Ask concierge"
              >
                {conciergeLoading ? <SpinnerGap size={19} className="animate-spin" /> : <ArrowRight size={19} weight="bold" />}
              </button>
            </div>
            {locationMessage ? (
              <p
                className={`mt-2 text-xs font-semibold ${
                  locationStatus === "ready" ? "text-emerald-200" : "text-amber-100"
                }`}
              >
                {locationMessage}
              </p>
            ) : null}
          </form>
        </section>
      ) : null}

      {!conciergePanelOpen ? (
        <div
          className={`absolute bottom-5 z-10 hidden -translate-x-1/2 transition-[left,width] duration-300 md:block ${
            sidebarOpen
              ? "left-[calc(50%+215px)] w-[min(760px,calc(100vw-480px))]"
              : "left-1/2 w-[min(760px,calc(100vw-2rem))]"
          }`}
        >
          <div className="mb-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openSessionPlanner}
              disabled={conciergeLoading}
              className="inline-flex h-9 items-center justify-center gap-2 border border-white/12 bg-[#19120e]/94 px-3 text-xs font-semibold text-zinc-100 backdrop-blur transition hover:border-emerald-300 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Clock size={14} weight="bold" />
              Plan session
            </button>
            <button
              type="button"
              onClick={() => rebookSession("It's getting loud and I need a calmer place with a plug.")}
              disabled={conciergeLoading}
              className="inline-flex h-9 items-center justify-center gap-2 border border-white/12 bg-[#19120e]/94 px-3 text-xs font-semibold text-zinc-100 backdrop-blur transition hover:border-emerald-300 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Lightning size={14} weight="bold" />
              Find next spot
            </button>
          </div>
          <form
            className="flex items-center gap-3 border border-white/12 bg-[#19120e]/94 p-3 shadow-[0_18px_70px_rgba(0,0,0,0.32)] backdrop-blur"
            onSubmit={submitConcierge}
            autoComplete="off"
          >
            <label htmlFor="buildmaxxing-agent-bottom" className="sr-only">
              Ask the concierge
            </label>
            <button
              type="button"
              onClick={requestUserLocation}
              disabled={locationStatus === "requesting"}
              className={`inline-flex h-12 shrink-0 items-center justify-center gap-2 border px-3 text-sm font-semibold transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-70 ${
                locationStatus === "ready"
                  ? "border-emerald-300 bg-emerald-300 text-zinc-950"
                  : "border-white/12 bg-[#241f1a] text-zinc-100 hover:border-emerald-300"
              }`}
              aria-label={locationStatus === "ready" ? "Refresh current location" : "Use current location"}
            >
              {locationStatus === "requesting" ? (
                <SpinnerGap size={18} className="animate-spin" />
              ) : (
                <NavigationArrow size={18} weight={locationStatus === "ready" ? "fill" : "bold"} />
              )}
              <span className="hidden sm:inline">
                {locationStatus === "ready" ? "Near me" : "Use location"}
              </span>
            </button>
            <input
              ref={conciergePromptRef}
              id="buildmaxxing-agent-bottom"
              name="buildmaxxing-agent-bottom-draft"
              value={conciergeMessage}
              onChange={(event) => setConciergeMessage(event.target.value)}
              placeholder="Tell me your work block, calls, and constraints"
              autoComplete="off"
              aria-autocomplete="none"
              className="h-12 min-w-0 flex-1 bg-transparent px-4 text-base font-medium text-zinc-100 outline-none placeholder:text-zinc-500"
            />
            <button
              type="submit"
              disabled={conciergeLoading}
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center bg-[#e46f52] text-zinc-950 transition hover:bg-[#f08a6e] active:translate-y-px"
              aria-label="Ask concierge"
            >
              {conciergeLoading ? <SpinnerGap size={20} className="animate-spin" /> : <ArrowRight size={20} weight="bold" />}
            </button>
          </form>
          {locationMessage ? (
            <p
              className={`mt-2 text-xs font-semibold ${
                locationStatus === "ready" ? "text-emerald-200" : "text-amber-100"
              }`}
            >
              {locationMessage}
            </p>
          ) : null}
        </div>
      ) : null}

      <CafePlaceModal
        cafe={detailCafe}
        onClose={closeCafeDetails}
        onOpenFeedback={(cafe) => openFeedback(cafe)}
        userLocation={userLocation}
      />
      {feedbackCafe ? (
        <FeedbackModal
          cafes={availableCafes}
          key={feedbackCafe.id}
          initialCafe={feedbackCafe}
          onClose={closeFeedback}
        />
      ) : null}
    </main>
  );
}

function SessionPlanCard({
  cafes: cafePool,
  onFocus,
  onOpenDetails,
  plan,
  userLocation,
}: {
  cafes: Cafe[];
  onFocus: (cafe: Cafe) => void;
  onOpenDetails: (cafe: Cafe) => void;
  plan: WorkSessionPlan;
  userLocation?: UserLocation | null;
}) {
  return (
    <section className="mt-4 border border-emerald-300/20 bg-emerald-300/10 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-emerald-300/25 bg-[#0f0c09] text-emerald-200">
          {plan.mode === "mid_session_move" ? (
            <NavigationArrow size={18} weight="fill" />
          ) : (
            <Clock size={18} weight="bold" />
          )}
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-6 text-zinc-100">{plan.headline}</h3>
          <p className="mt-1 text-sm leading-6 text-zinc-400">{plan.summary}</p>
          {plan.totalDuration || plan.endTime ? (
            <p className="mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">
              {[plan.totalDuration, plan.endTime ? `ends ${plan.endTime}` : undefined].filter(Boolean).join(" - ")}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {plan.stops.map((stop) => {
          const cafe = cafePool.find((item) => item.id === stop.cafeId);
          if (!cafe) return null;
          return (
            <article key={stop.id} className="border border-white/10 bg-[#15110e] p-3">
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-200">
                    {stop.start} - {stop.end}
                  </p>
                  <h4 className="mt-2 truncate text-sm font-semibold text-zinc-100">{stop.title}</h4>
                  <p className="mt-1 truncate text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">
                    {cafe.name} - {cafe.area}
                  </p>
                </div>
                {stop.walkFromPreviousMin ? (
                  <span className="self-start border border-white/12 bg-[#0f0c09] px-2.5 py-1 text-xs font-semibold text-zinc-300">
                    {stop.walkFromPreviousMin} min walk
                  </span>
                ) : null}
              </div>
              <p className="mt-3 text-sm leading-6 text-zinc-400">{stop.purpose}</p>
              <p className="mt-2 text-xs leading-5 text-zinc-500">{stop.rationale}</p>
              {stop.caution ? (
                <p className="mt-2 border border-amber-300/25 bg-amber-300/10 px-2.5 py-2 text-xs font-semibold leading-5 text-amber-100">
                  {stop.caution}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {stop.needs.slice(0, 4).map((need) => (
                  <span
                    key={`${stop.id}-${need}`}
                    className="border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100"
                  >
                    {need}
                  </span>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => onFocus(cafe)}
                  className="inline-flex h-10 items-center justify-center border border-white/12 bg-[#0f0c09] text-xs font-semibold text-zinc-100 transition hover:border-emerald-300 active:translate-y-px"
                >
                  Focus
                </button>
                <button
                  type="button"
                  onClick={() => onOpenDetails(cafe)}
                  className="inline-flex h-10 items-center justify-center border border-white/12 bg-[#0f0c09] text-xs font-semibold text-zinc-100 transition hover:border-emerald-300 active:translate-y-px"
                >
                  Details
                </button>
                <a
                  href={googleDirectionsUrl(cafe, userLocation)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center justify-center gap-1.5 bg-emerald-300 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-200 active:translate-y-px"
                >
                  Navigate
                  <ArrowSquareOut size={14} weight="bold" />
                </a>
              </div>
            </article>
          );
        })}
      </div>

      {plan.nextAction || plan.contingency ? (
        <div className="mt-4 grid gap-2 text-sm leading-6 text-zinc-300">
          {plan.nextAction ? <p>{plan.nextAction}</p> : null}
          {plan.contingency ? <p className="text-xs text-zinc-500">{plan.contingency}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function SessionWatchCard({
  active,
  currentCafe,
  disabled,
  onRebook,
}: {
  active: boolean;
  currentCafe: Cafe;
  disabled: boolean;
  onRebook: (reason: string) => void;
}) {
  const actions = [
    {
      label: "Too loud",
      reason: "It is getting loud and I still need to focus.",
    },
    {
      label: "Battery low",
      reason: "My laptop is around 20% and I did not get a plug.",
    },
    {
      label: "Call spot",
      reason: "I need a quieter place for a call.",
    },
  ];

  return (
    <section className="mt-4 border border-white/10 bg-[#15110e] p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-white/12 bg-[#0f0c09] text-emerald-200">
          <Lightning size={17} weight="bold" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">
            {active ? "Session watch" : "Mid-session rescue"}
          </h3>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            {active
              ? `If ${currentCafe.name} stops working, reroute the remaining block.`
              : "One tap finds a better next spot from the selected cafe."}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => onRebook(action.reason)}
            disabled={disabled}
            className="inline-flex min-h-10 items-center justify-center border border-white/12 bg-[#0f0c09] px-2 text-xs font-semibold text-zinc-100 transition hover:border-emerald-300 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
          >
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function SidebarFilter({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 border px-3 text-xs font-bold uppercase tracking-[0.12em] transition active:translate-y-px ${
        active
          ? "border-emerald-300 bg-emerald-300 text-zinc-950"
          : "border-white/12 bg-[#241f1a] text-zinc-300 hover:border-emerald-300 hover:text-emerald-200"
      }`}
    >
      {children}
    </button>
  );
}

function CafeListItem({
  cafe,
  distanceLabel,
  expanded,
  selected,
  onSelect,
  onOpenDetails,
  onOpenFeedback,
}: {
  cafe: Cafe;
  distanceLabel?: string;
  expanded: boolean;
  selected: boolean;
  onSelect: () => void;
  onOpenDetails: () => void;
  onOpenFeedback: () => void;
}) {
  const score = calculateWorkScore(cafe);

  return (
    <article
      className={`border-b border-white/10 transition ${
        selected ? "bg-[#231d17]" : "bg-transparent hover:bg-[#211b16]"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 px-5 py-5 text-left"
        aria-expanded={expanded}
      >
        <div className="min-w-0">
          <h2 className="truncate font-serif text-xl font-semibold tracking-tight text-zinc-50">
            {cafe.name}
          </h2>
          <p className="mt-2 font-mono text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
            {cafe.area}
            {distanceLabel ? (
              <>
                <span className="mx-2 text-zinc-700">-</span>
                <span className="text-emerald-200">{distanceLabel}</span>
              </>
            ) : null}
          </p>
          <p className="mt-2 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.12em] text-zinc-500">
            <span className={`h-2 w-2 rounded-full ${cafe.laptopFriendly ? "bg-emerald-400" : "bg-zinc-600"}`} />
            {formatNoise(cafe.noiseLevel)}
            <span className="text-zinc-700">-</span>
            {cafe.recommendedStay}
          </p>
        </div>

        <div className="text-right">
          <p className="text-2xl font-semibold tracking-tight text-zinc-100">{score}</p>
          <p className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-zinc-500">
            score
          </p>
        </div>

        <CaretDown
          size={18}
          weight="bold"
          className={`text-zinc-500 transition ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded ? (
        <div className="px-5 pb-5">
          <div className="grid grid-cols-[104px_1fr] gap-4">
            <div className="relative h-28 overflow-hidden bg-zinc-800">
              <Image
                src={cafe.imageUrl}
                alt={cafe.imageAlt}
                fill
                unoptimized
                sizes="104px"
                className="object-cover"
              />
            </div>
            <div>
              <p className="text-sm leading-6 text-zinc-300">{cafe.workSummary}</p>
              <p className="mt-3 text-sm font-semibold text-emerald-200">
                {getWorkScoreLabel(score)}
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <MiniMetric icon={<WifiHigh size={15} weight="bold" />} label="WiFi" value={`${cafe.wifiScore}/5`} />
            <MiniMetric
              icon={<BatteryCharging size={15} weight="bold" />}
              label="Plugs"
              value={`${cafe.plugScore}/5`}
            />
            <MiniMetric icon={<Star size={15} weight="bold" />} label="Rating" value={cafe.rating} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {cafe.bestFor.map((tag) => (
              <span
                key={tag}
                className="border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-xs font-semibold text-emerald-100"
              >
                {tag}
              </span>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onOpenDetails}
              className="inline-flex h-10 items-center justify-center gap-2 border border-white/12 bg-[#16120f] text-sm font-semibold text-zinc-100 transition hover:border-emerald-300 active:translate-y-px"
            >
              Full details
              <ArrowRight size={15} weight="bold" />
            </button>
            <button
              type="button"
              onClick={onOpenFeedback}
              className="inline-flex h-10 items-center justify-center gap-2 border border-white/12 bg-[#16120f] text-sm font-semibold text-zinc-100 transition hover:border-emerald-300 active:translate-y-px"
            >
              Feedback
              <ArrowRight size={15} weight="bold" />
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function MiniMetric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="border border-white/10 bg-[#15110e] p-3">
      <div className="flex items-center gap-1.5 text-emerald-200">{icon}</div>
      <p className="mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-zinc-100">{value}</p>
    </div>
  );
}

function MiniFit({
  label,
  value,
  tone = "text-zinc-100",
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <div className="min-h-14 border border-white/10 bg-[#0f0c09] p-2">
      <p className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-600">
        {label}
      </p>
      <p className={`mt-1 truncate text-xs font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function FallbackMap({
  cafes: visibleCafes,
  selectedCafe,
  status,
  onSelect,
}: {
  cafes: Cafe[];
  selectedCafe: Cafe;
  status: MapStatus;
  onSelect: (cafe: Cafe) => void;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#151817]">
      <div className="absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(255,255,255,.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.045)_1px,transparent_1px)] [background-size:54px_54px]" />
      <div className="absolute inset-0 opacity-70 [background-image:radial-gradient(circle_at_42%_54%,rgba(56,72,67,.85),transparent_19%),radial-gradient(circle_at_60%_42%,rgba(69,81,77,.8),transparent_18%),radial-gradient(circle_at_54%_70%,rgba(42,62,56,.72),transparent_21%)]" />
      <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(33deg,transparent_0_47%,rgba(255,255,255,.16)_48%,transparent_51%),linear-gradient(121deg,transparent_0_46%,rgba(255,255,255,.11)_47%,transparent_50%)] [background-size:220px_160px]" />

      <div className="absolute left-[39%] top-[8%] h-[88%] w-[14%] -rotate-12 rounded-[52%] bg-[#242b2a]" />
      <div className="absolute left-[52%] top-[18%] h-[72%] w-[18%] rotate-12 rounded-[48%] bg-[#202827]" />
      <div className="absolute bottom-[10%] left-[50%] h-[20%] w-[38%] rounded-[50%] bg-[#202827]" />

      {visibleCafes.map((cafe) => {
        const point = projectCafe(cafe);
        const selected = cafe.id === selectedCafe.id;
        return (
          <button
            key={cafe.id}
            type="button"
            onClick={() => onSelect(cafe)}
            title={`${cafe.name} - ${openStatusLabel(cafe)} - WiFi ${cafe.wifiScore}/5 - Plugs ${cafe.plugScore}/5`}
            className={`group absolute z-10 -translate-x-1/2 -translate-y-full transition ${
              selected ? "scale-125" : "hover:scale-110"
            }`}
            style={point}
            aria-label={`Select ${cafe.name}`}
          >
            <span
              className="relative block h-8 w-6 rounded-t-full rounded-bl-full border-2 border-[#121412] shadow-[0_8px_18px_rgba(0,0,0,.42)]"
              style={{
                backgroundColor: pinColor(cafe),
                transform: "rotate(45deg)",
              }}
            >
              <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-50" />
            </span>
            <span className="pointer-events-none absolute bottom-11 left-1/2 z-50 w-56 -translate-x-1/2 translate-y-1 border border-white/15 bg-[#19120e]/96 p-3 text-left text-zinc-100 opacity-0 shadow-[0_18px_58px_rgba(0,0,0,0.42)] backdrop-blur transition group-hover:translate-y-0 group-hover:opacity-100 group-focus:translate-y-0 group-focus:opacity-100">
              <span className="block truncate text-sm font-bold">{cafe.name}</span>
              <span className="mt-1 block font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                {cafe.area} - {calculateWorkScore(cafe)} score
              </span>
              <span className="mt-2 block text-xs leading-5 text-zinc-300">
                {openStatusLabel(cafe)} - WiFi {cafe.wifiScore}/5 - Plugs {cafe.plugScore}/5 - {formatNoise(cafe.noiseLevel)}
              </span>
            </span>
          </button>
        );
      })}

      <div className="absolute right-5 top-24 max-w-xs border border-white/12 bg-[#19120e]/90 px-4 py-3 text-sm leading-6 text-zinc-300 backdrop-blur">
        {status === "missing-key"
          ? "Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to enable Google Maps. Showing local map fallback."
          : "Google Maps could not load. Showing local map fallback."}
      </div>

      <div className="absolute left-[42%] top-[66%] flex items-center gap-2 font-mono text-sm font-bold uppercase tracking-[0.16em] text-zinc-500">
        <NavigationArrow size={17} weight="fill" />
        London
      </div>
      <div className="absolute left-[57%] top-[40%] font-mono text-xs font-bold uppercase tracking-[0.16em] text-zinc-600">
        Shoreditch
      </div>
      <div className="absolute left-[37%] top-[43%] font-mono text-xs font-bold uppercase tracking-[0.16em] text-zinc-600">
        Soho
      </div>
    </div>
  );
}
