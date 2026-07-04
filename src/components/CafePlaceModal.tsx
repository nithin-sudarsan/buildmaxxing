"use client";

import Image from "next/image";
import {
  Armchair,
  ArrowSquareOut,
  BatteryCharging,
  CalendarBlank,
  CheckCircle,
  Clock,
  Coffee,
  ForkKnife,
  Globe,
  Headphones,
  ListBullets,
  MapPin,
  NavigationArrow,
  Phone,
  SpinnerGap,
  Star,
  UsersThree,
  Warning,
  WifiHigh,
  X,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { Cafe, CafePlaceDetails, UserLocation } from "@/lib/types";
import { calculateWorkProfileScore, formatNoise, getWorkScoreLabel } from "@/lib/scoring";

type CafePlaceModalProps = {
  cafe: Cafe | null;
  onClose: () => void;
  onOpenFeedback?: (cafe: Cafe) => void;
  userLocation?: UserLocation | null;
};

function formatStatus(status?: string) {
  return status?.replaceAll("_", " ").toLowerCase();
}

function googleDirectionsUrl(details: Pick<CafePlaceDetails, "lat" | "lng">, userLocation?: UserLocation | null) {
  const params = new URLSearchParams({
    api: "1",
    destination: `${details.lat},${details.lng}`,
    travelmode: "walking",
  });
  if (userLocation) {
    params.set("origin", `${userLocation.lat},${userLocation.lng}`);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function todayBusyDay() {
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return days[new Date().getDay()];
}

function formatHour(hour: number) {
  if (hour === 0 || hour === 24) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour > 12) return `${hour - 12} PM`;
  return `${hour} AM`;
}

function menuSourceLabel(source: string) {
  if (source === "review") return "from reviews";
  if (source === "google") return "from Google";
  return "estimate";
}

function busyTone(level: string) {
  if (level === "quiet") return "bg-emerald-400";
  if (level === "moderate") return "bg-amber-400";
  return "bg-[#e46f52]";
}

function workDetailTone(tone: string) {
  if (tone === "good") return "border-emerald-300/20 bg-emerald-300/10 text-emerald-100";
  if (tone === "warn") return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  return "border-white/10 bg-[#15110e] text-zinc-200";
}

function fallbackDetails(cafe: Cafe): CafePlaceDetails {
  return {
    id: cafe.id,
    seedName: cafe.name,
    name: cafe.name,
    area: cafe.area,
    address: cafe.address,
    lat: cafe.lat,
    lng: cafe.lng,
    rating: cafe.rating,
    reviewCount: cafe.reviewCount,
    imageUrl: cafe.imageUrl,
    imageAlt: cafe.imageAlt,
    source: "seed_fallback",
    matchConfidence: "fallback",
    reviewSnippets: [],
    workProfile: {
      wifiScore: cafe.wifiScore,
      plugScore: cafe.plugScore,
      seatingScore: cafe.seatingScore,
      noiseLevel: cafe.noiseLevel,
      laptopFriendly: cafe.laptopFriendly,
      callFriendly: cafe.callFriendly,
      bestTime: cafe.bestTime,
      recommendedStay: cafe.recommendedStay,
      bestFor: cafe.bestFor,
      workSummary: cafe.workSummary,
      evidence: ["Local seed fallback while Google Places details load."],
      provider: "fallback",
    },
  };
}

export function CafePlaceModal({ cafe, onClose, onOpenFeedback, userLocation }: CafePlaceModalProps) {
  const [details, setDetails] = useState<CafePlaceDetails | null>(null);
  const [error, setError] = useState<{ cafeId: string; message: string } | null>(null);
  const [selectedBusyDay, setSelectedBusyDay] = useState<string | null>(null);

  useEffect(() => {
    if (!cafe) return;
    const controller = new AbortController();

    fetch(`/api/cafes/${cafe.id}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Cafe details failed");
        return response.json() as Promise<CafePlaceDetails>;
      })
      .then((nextDetails) => {
        setError(null);
        setDetails(nextDetails);
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError({
          cafeId: cafe.id,
          message: "Google Places details are unavailable. Showing local details.",
        });
        setDetails(fallbackDetails(cafe));
      });

    return () => controller.abort();
  }, [cafe]);

  useEffect(() => {
    if (!cafe) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [cafe, onClose]);

  const visibleDetails = useMemo(() => {
    if (!cafe) return null;
    return details?.id === cafe.id ? details : fallbackDetails(cafe);
  }, [cafe, details]);
  const activeBusyDay = useMemo(() => {
    const days = visibleDetails?.busyTimes?.days ?? [];
    if (!days.length) return undefined;
    return (
      days.find((day) => day.day === selectedBusyDay) ??
      days.find((day) => day.day === todayBusyDay()) ??
      days[0]
    );
  }, [selectedBusyDay, visibleDetails]);

  if (!cafe || !visibleDetails) return null;

  const errorMessage = error?.cafeId === cafe.id ? error.message : null;
  const loading = details?.id !== cafe.id && !errorMessage;
  const score = calculateWorkProfileScore({
    ...visibleDetails.workProfile,
    rating: visibleDetails.rating,
  });
  const sourceLabel =
    visibleDetails.source === "google_places" ? "Google Places match" : "Local fallback";
  const sourceTone =
    visibleDetails.source === "google_places"
      ? "border-emerald-300/35 bg-emerald-300/10 text-emerald-100"
      : "border-amber-300/35 bg-amber-300/10 text-amber-100";
  const menuHighlights = visibleDetails.menuHighlights ?? [];
  const workDetails = visibleDetails.workDetails ?? [];
  const knownFor = visibleDetails.knownFor ?? visibleDetails.workProfile.bestFor;
  const amenities = visibleDetails.amenities ?? [];
  const cautions = visibleDetails.cautions ?? [];
  const howWeKnow = visibleDetails.howWeKnow ?? [
    visibleDetails.source === "google_places" ? "Google Places" : "Seed data",
    visibleDetails.workProfile.provider === "openrouter" ? "AI review analysis" : "Work suitability estimate",
  ];
  const openLabel =
    visibleDetails.openNow === true
      ? "Open now"
      : visibleDetails.openNow === false
        ? "Closed now"
        : "Hours need checking";

  return (
    <div
      className="detail-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/62 p-3 text-zinc-50 backdrop-blur-sm sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label={`${visibleDetails.name} details`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="detail-shell grid max-h-[92dvh] w-full max-w-7xl overflow-hidden border border-white/12 bg-[#17130f] shadow-[0_30px_120px_rgba(0,0,0,0.55)] md:grid-cols-[minmax(320px,0.78fr)_minmax(0,1.22fr)]">
        <div className="detail-hero relative min-h-[260px] bg-[#211c17] md:min-h-full">
          <Image
            src={visibleDetails.imageUrl}
            alt={visibleDetails.imageAlt}
            fill
            unoptimized
            sizes="(min-width: 768px) 42vw, 100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/72 via-black/10 to-black/20" />
          <div className="absolute left-5 top-5 flex flex-wrap gap-2">
            <span className={`border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] ${sourceTone}`}>
              {sourceLabel}
            </span>
            <span className="border border-white/20 bg-black/35 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-zinc-100">
              {visibleDetails.matchConfidence} confidence
            </span>
          </div>
          <div className="absolute bottom-5 left-5 right-5">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-zinc-300">
              {visibleDetails.area}
            </p>
            <h2 className="mt-2 font-serif text-4xl font-semibold leading-tight tracking-tight text-white">
              {visibleDetails.name}
            </h2>
            {visibleDetails.name !== visibleDetails.seedName ? (
              <p className="mt-2 text-sm text-zinc-300">
                Matched from list item: {visibleDetails.seedName}
              </p>
            ) : null}
          </div>
        </div>

        <div className="detail-body max-h-[92dvh] overflow-y-auto p-5 sm:p-7 lg:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-300">
                <span className="inline-flex items-center gap-1.5">
                  <Star size={16} weight="fill" className="text-emerald-300" />
                  {visibleDetails.rating.toFixed(1)} ({visibleDetails.reviewCount})
                </span>
                {visibleDetails.openNow !== undefined ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Clock size={16} weight="bold" />
                    {visibleDetails.openNow ? "Open now" : "Closed now"}
                  </span>
                ) : null}
                {visibleDetails.priceLevel ? (
                  <span>{formatStatus(visibleDetails.priceLevel)}</span>
                ) : null}
              </div>
              <p className="mt-3 flex items-start gap-2 text-sm leading-6 text-zinc-400">
                <MapPin size={17} weight="bold" className="mt-1 shrink-0 text-zinc-500" />
                {visibleDetails.address}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center border border-white/12 bg-[#241f1a] text-zinc-100 transition hover:border-emerald-300 active:translate-y-px"
              aria-label="Close cafe details"
            >
              <X size={18} weight="bold" />
            </button>
          </div>

          {loading ? (
            <div className="mt-5 inline-flex items-center gap-2 border border-white/12 bg-[#211b16] px-3 py-2 text-sm font-semibold text-zinc-300">
              <SpinnerGap size={16} className="animate-spin" />
              Fetching Google Places details
            </div>
          ) : null}
          {errorMessage ? (
            <p className="mt-5 border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
              {errorMessage}
            </p>
          ) : null}

          <div className="detail-lead-card mt-6 grid gap-4 border border-white/10 bg-[#0f0c09] p-5 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-end">
              <div>
                <p className="text-6xl font-semibold tracking-tight text-zinc-50">{score}</p>
                <p className="mt-1 font-mono text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                  work score
                </p>
              </div>
              <div className="pb-1">
                <div className="flex flex-wrap gap-2">
                  <span className="border border-emerald-300/25 bg-emerald-300/10 px-2.5 py-1 text-xs font-bold uppercase tracking-[0.14em] text-emerald-100">
                    {getWorkScoreLabel(score)}
                  </span>
                  {score >= 88 ? (
                    <span className="border border-white/15 bg-[#241f1a] px-2.5 py-1 text-xs font-bold uppercase tracking-[0.14em] text-zinc-200">
                      Top work cafe
                    </span>
                  ) : null}
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-400">
                  {visibleDetails.workProfile.workSummary}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <DetailMetric icon={<WifiHigh size={16} weight="bold" />} label="Wi-Fi" value={`${visibleDetails.workProfile.wifiScore}/5`} />
              <DetailMetric icon={<BatteryCharging size={16} weight="bold" />} label="Plugs" value={`${visibleDetails.workProfile.plugScore}/5`} />
              <DetailMetric icon={<Armchair size={16} weight="bold" />} label="Seating" value={`${visibleDetails.workProfile.seatingScore}/5`} />
            </div>
          </div>

          <section className="detail-section mt-7 border-t border-white/10 pt-6">
            <SectionHeading icon={<CheckCircle size={18} weight="bold" />}>Quick read</SectionHeading>
            <div className="mt-3 grid gap-2">
              <InsightRow
                icon={<CheckCircle size={18} weight="bold" />}
                title={visibleDetails.source === "google_places" ? "Google-matched cafe" : "Local fallback"}
                detail={`${visibleDetails.matchConfidence} confidence match for this listing.`}
                tone="good"
              />
              <InsightRow
                icon={<Headphones size={18} weight="bold" />}
                title={`${formatNoise(visibleDetails.workProfile.noiseLevel)} room`}
                detail={visibleDetails.workProfile.noiseLevel === "quiet" ? "A calmer pick for focus." : "Headphones are sensible at peak times."}
                tone={visibleDetails.workProfile.noiseLevel === "quiet" ? "good" : "neutral"}
              />
              <InsightRow
                icon={<Clock size={18} weight="bold" />}
                title={openLabel}
                detail={visibleDetails.workProfile.bestTime}
                tone={visibleDetails.openNow === false ? "warn" : "neutral"}
              />
            </div>
          </section>

          {menuHighlights.length ? (
            <section className="detail-section mt-7 border-t border-white/10 pt-6">
              <SectionHeading icon={<Coffee size={18} weight="bold" />}>Menu signals</SectionHeading>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {menuHighlights.map((item) => (
                  <div key={`${item.name}-${item.source}`} className="detail-info-card border border-white/10 bg-[#15110e] p-4">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                      {menuSourceLabel(item.source)}
                    </p>
                    <p className="mt-2 text-lg font-semibold text-zinc-100">{item.name}</p>
                    {item.priceHint ? (
                      <p className="mt-1 text-sm font-semibold text-zinc-400">{item.priceHint}</p>
                    ) : null}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                Menu data comes from review mentions or broad Google cafe signals when no menu is exposed.
              </p>
            </section>
          ) : null}

          {workDetails.length ? (
            <section className="detail-section mt-7 border-t border-white/10 pt-6">
              <SectionHeading icon={<ListBullets size={18} weight="bold" />}>
                {"What it's like to work here"}
              </SectionHeading>
              <div className="detail-row-group mt-4 divide-y divide-white/10 border border-white/10 bg-[#15110e]">
                {workDetails.map((item) => (
                  <div key={item.label} className="grid grid-cols-[1fr_auto] gap-4 p-4 sm:p-5">
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">{item.label}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{item.detail}</p>
                    </div>
                    <span className={`self-start border px-2.5 py-1 text-xs font-bold ${workDetailTone(item.tone)}`}>
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {cautions.length ? (
            <section className="detail-note-card mt-7 rounded-none border border-amber-300/25 bg-amber-300/10 p-4 sm:p-5">
              <SectionHeading icon={<Warning size={18} weight="bold" />}>Worth knowing</SectionHeading>
              <div className="mt-3 grid gap-3">
                {cautions.map((item) => (
                  <div key={item.title}>
                    <p className="text-sm font-semibold text-amber-100">{item.title}</p>
                    <p className="mt-1 text-sm leading-6 text-amber-100/75">
                      {item.detail} <span className="text-amber-100/50">- {item.source}</span>
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="detail-section mt-7 border-t border-white/10 pt-6">
            <SectionHeading icon={<ForkKnife size={18} weight="bold" />}>Good to know</SectionHeading>
            <div className="mt-3 grid gap-4">
              {knownFor.length ? (
                <div>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                    Known for
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {knownFor.map((tag) => (
                      <span key={tag} className="border border-white/12 bg-[#15110e] px-3 py-1.5 text-xs font-semibold text-zinc-200">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {amenities.length ? (
                <div>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                    Also offers
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {amenities.map((item) => (
                      <span key={`${item.label}-${item.source}`} className="border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">
                        {item.label}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          {visibleDetails.openingHours?.length ? (
            <section className="detail-section mt-7 border-t border-white/10 pt-6">
              <SectionHeading icon={<CalendarBlank size={18} weight="bold" />}>Hours</SectionHeading>
              <div className="detail-row-group mt-4 grid gap-1 border border-white/10 bg-[#15110e] p-4 text-sm leading-6 text-zinc-300 sm:p-5">
                {visibleDetails.openingHours.map((line) => (
                  <p key={line} className="grid grid-cols-[minmax(84px,0.6fr)_1fr] gap-3">
                    <span className="font-semibold text-zinc-100">{line.split(":")[0]}</span>
                    <span>{line.includes(":") ? line.slice(line.indexOf(":") + 1).trim() : line}</span>
                  </p>
                ))}
              </div>
              <p className="mt-2 text-xs font-semibold text-amber-100/75">
                Hours can vary across sources, so double-check before a late visit.
              </p>
            </section>
          ) : null}

          {visibleDetails.busyTimes && activeBusyDay ? (
            <section className="detail-section mt-7 border-t border-white/10 pt-6">
              <SectionHeading icon={<UsersThree size={18} weight="bold" />}>Busy times</SectionHeading>
              <div className="mt-3 grid grid-cols-7 gap-1.5">
                {visibleDetails.busyTimes.days.map((day) => (
                  <button
                    key={day.day}
                    type="button"
                    onClick={() => setSelectedBusyDay(day.day)}
                    className={`h-10 border text-xs font-bold transition active:translate-y-px sm:h-11 ${
                      activeBusyDay.day === day.day
                        ? "border-emerald-300 bg-emerald-300 text-zinc-950"
                        : "border-white/12 bg-[#15110e] text-zinc-300 hover:border-emerald-300"
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
              <BusyTimesChart day={activeBusyDay} />
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-semibold text-zinc-500">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-emerald-400" />Quiet</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-amber-400" />Moderate</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-[#e46f52]" />Busy</span>
              </div>
              <p className="mt-4 text-sm font-semibold italic text-zinc-300">{visibleDetails.busyTimes.quietestLabel}</p>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                Estimate based on Maps popularity, opening hours, reviews, and the work profile.
              </p>
            </section>
          ) : null}

          {visibleDetails.reviewSnippets.length ? (
            <section className="detail-section mt-7 border-t border-white/10 pt-6">
              <SectionHeading icon={<Star size={18} weight="bold" />}>What people say</SectionHeading>
              <div className="mt-3 grid gap-3">
                {visibleDetails.reviewSnippets.map((review, index) => (
                  <blockquote
                    key={`${review.authorName ?? "review"}-${index}`}
                    className="border border-white/10 bg-[#15110e] p-4 text-sm leading-6 text-zinc-300"
                  >
                    <p>{review.text}</p>
                    <footer className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">
                      {review.authorName ?? "Google reviewer"}
                      {review.rating ? ` - ${review.rating}/5` : ""}
                      {review.relativePublishTimeDescription ? ` - ${review.relativePublishTimeDescription}` : ""}
                    </footer>
                  </blockquote>
                ))}
              </div>
            </section>
          ) : null}

          {visibleDetails.workProfile.evidence.length || howWeKnow.length ? (
            <section className="detail-section mt-7 border-t border-white/10 pt-6">
              <p className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
                How we know
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                {howWeKnow.join(" - ")}
              </p>
              {visibleDetails.workProfile.evidence.length ? (
                <div className="mt-3 grid gap-2">
                  {visibleDetails.workProfile.evidence.map((item) => (
                    <p key={item} className="border border-white/10 bg-[#15110e] px-3 py-2 text-sm leading-6 text-zinc-300">
                      {item}
                    </p>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="mt-7 flex flex-wrap gap-2">
            <a
              href={googleDirectionsUrl(visibleDetails, userLocation)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center justify-center gap-2 border border-emerald-300/35 bg-emerald-300 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-200 active:translate-y-px"
            >
              Navigate
              <NavigationArrow size={16} weight="fill" />
            </a>
            {visibleDetails.googleMapsUri ? (
              <a
                href={visibleDetails.googleMapsUri}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center justify-center gap-2 border border-white/12 bg-[#241f1a] px-4 text-sm font-semibold text-zinc-100 transition hover:border-emerald-300 active:translate-y-px"
              >
                Google Maps
                <ArrowSquareOut size={16} weight="bold" />
              </a>
            ) : null}
            {visibleDetails.websiteUri ? (
              <a
                href={visibleDetails.websiteUri}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center justify-center gap-2 border border-white/12 bg-[#241f1a] px-4 text-sm font-semibold text-zinc-100 transition hover:border-emerald-300 active:translate-y-px"
              >
                Website
                <Globe size={16} weight="bold" />
              </a>
            ) : null}
            {visibleDetails.phone ? (
              <a
                href={`tel:${visibleDetails.phone.replaceAll(" ", "")}`}
                className="inline-flex h-11 items-center justify-center gap-2 border border-white/12 bg-[#241f1a] px-4 text-sm font-semibold text-zinc-100 transition hover:border-emerald-300 active:translate-y-px"
              >
                Call
                <Phone size={16} weight="bold" />
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => onOpenFeedback?.(cafe)}
              className="inline-flex h-11 items-center justify-center border border-white/12 bg-[#241f1a] px-4 text-sm font-semibold text-zinc-100 transition hover:border-emerald-300 active:translate-y-px"
            >
              Report discrepancy
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailMetric({
  icon,
  label,
  value,
}: {
  icon?: ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="detail-metric min-h-24 border border-white/10 bg-[#15110e] p-3">
      <div className="flex h-5 items-center gap-1.5 text-emerald-200">{icon}</div>
      <p className="mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold leading-5 text-zinc-100">{value}</p>
    </div>
  );
}

function SectionHeading({ children, icon }: { children: ReactNode; icon: ReactNode }) {
  return (
    <h3 className="inline-flex items-center gap-2 text-xl font-semibold tracking-tight text-zinc-50">
      <span className="text-emerald-200">{icon}</span>
      {children}
    </h3>
  );
}

function InsightRow({
  detail,
  icon,
  title,
  tone,
}: {
  detail: string;
  icon: ReactNode;
  title: string;
  tone: "good" | "neutral" | "warn";
}) {
  return (
    <div className={`detail-insight-row grid grid-cols-[40px_1fr] gap-3 border p-3 sm:p-4 ${workDetailTone(tone)}`}>
      <div className="flex h-10 w-10 items-center justify-center border border-white/10 bg-[#0f0c09] text-emerald-200">
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-zinc-100">{title}</p>
        <p className="mt-1 text-xs leading-5 text-zinc-400">{detail}</p>
      </div>
    </div>
  );
}

function BusyTimesChart({
  day,
}: {
  day: NonNullable<CafePlaceDetails["busyTimes"]>["days"][number];
}) {
  const nowHour = new Date().getHours();

  return (
    <div className="busy-chart mt-4 border border-white/10 bg-[#15110e] p-4">
      <div className="busy-chart-plot flex h-44 items-end gap-1.5 border border-white/10 bg-[#0f0c09] px-3 pb-8 pt-8">
        {day.hours.map((hour) => {
          const isNow = hour.hour === nowHour;
          return (
            <div key={hour.hour} className="relative flex h-full min-w-0 flex-1 items-end justify-center">
              {isNow ? (
                <span className="absolute -top-6 text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-300">
                  now
                </span>
              ) : null}
              <div
                className={`w-full min-w-[8px] max-w-8 border border-black/20 transition-[height] duration-300 ${busyTone(hour.level)} ${
                  isNow ? "outline outline-2 outline-zinc-100" : ""
                }`}
                style={{ height: `${Math.max(14, Math.min(100, hour.value))}%` }}
                title={`${formatHour(hour.hour)} - ${hour.level}`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 grid grid-cols-3 text-xs font-semibold text-zinc-500">
        <span>{formatHour(day.hours[0]?.hour ?? 6)}</span>
        <span className="text-center">{day.summary}</span>
        <span className="text-right">
          {formatHour((day.hours[day.hours.length - 1]?.hour ?? 23) + 1)}
        </span>
      </div>
    </div>
  );
}
