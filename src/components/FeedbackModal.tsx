"use client";

import Image from "next/image";
import { CheckCircle, SpinnerGap, X } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import type { Cafe, FeedbackExtraction } from "@/lib/types";

type FeedbackModalProps = {
  cafes: Cafe[];
  initialCafe: Cafe;
  onClose: () => void;
};

function formatExtractedNoise(noise?: FeedbackExtraction["noiseLevel"]) {
  if (!noise) return "Not mentioned";
  return String(noise).replaceAll("_", " ");
}

export function FeedbackModal({ cafes, initialCafe, onClose }: FeedbackModalProps) {
  const [cafeId, setCafeId] = useState(initialCafe.id);
  const [rawReview, setRawReview] = useState("");
  const [extraction, setExtraction] = useState<FeedbackExtraction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cafe = useMemo(
    () => cafes.find((item) => item.id === cafeId) ?? initialCafe,
    [cafes, cafeId, initialCafe],
  );

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!rawReview.trim()) {
      setError("Add a quick note first.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/agent/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cafeId, rawReview }),
      });
      if (!response.ok) throw new Error("Feedback request failed");
      setExtraction((await response.json()) as FeedbackExtraction);
    } catch {
      setError("Could not extract the feedback. Try a more direct note.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="feedback-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-black/62 p-3 text-zinc-50 backdrop-blur-sm sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Cafe feedback"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="feedback-shell grid max-h-[92dvh] w-full max-w-5xl overflow-hidden border border-white/12 bg-[#17130f] shadow-[0_30px_120px_rgba(0,0,0,0.55)] lg:grid-cols-[0.82fr_1.18fr]">
        <div className="detail-hero relative hidden min-h-full bg-[#211c17] lg:block">
          <Image
            src={cafe.imageUrl}
            alt={cafe.imageAlt}
            fill
            unoptimized
            sizes="36vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/76 via-black/20 to-black/18" />
          <div className="absolute bottom-5 left-5 right-5">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-zinc-300">
              {cafe.area}
            </p>
            <h2 className="mt-2 font-serif text-4xl font-semibold leading-tight tracking-tight text-white">
              {cafe.name}
            </h2>
          </div>
        </div>

        <div className="max-h-[92dvh] overflow-y-auto p-5 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-emerald-200">
                Feedback
              </p>
              <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-zinc-50">
                Add work signals
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center border border-white/12 bg-[#241f1a] text-zinc-100 transition hover:border-emerald-300 active:translate-y-px"
              aria-label="Close feedback"
            >
              <X size={18} weight="bold" />
            </button>
          </div>

          <form onSubmit={submit} className="mt-6 grid gap-4">
            <div className="grid gap-2">
              <label htmlFor="feedback-cafe" className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                Cafe
              </label>
              <select
                id="feedback-cafe"
                value={cafeId}
                onChange={(event) => {
                  setCafeId(event.target.value);
                  setExtraction(null);
                }}
                className="h-12 rounded-none border border-white/12 bg-[#0f0c09] px-3 text-sm font-semibold text-zinc-100 outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-300/10"
              >
                {cafes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <label htmlFor="feedback-review" className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                Visit note
              </label>
              <textarea
                id="feedback-review"
                value={rawReview}
                onChange={(event) => setRawReview(event.target.value)}
                rows={6}
                placeholder="WiFi held up, plugs were scarce, quiet before lunch..."
                className="resize-none rounded-none border border-white/12 bg-[#0f0c09] p-4 text-base font-medium leading-7 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-300 focus:ring-4 focus:ring-emerald-300/10"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-12 items-center justify-center gap-2 bg-emerald-300 px-5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-200 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <SpinnerGap size={18} className="animate-spin" /> : <CheckCircle size={18} weight="bold" />}
              Extract work signals
            </button>
          </form>

          {error ? (
            <p className="mt-5 border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
              {error}
            </p>
          ) : null}

          {loading ? (
            <div className="mt-6 grid gap-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-14 animate-pulse border border-white/10 bg-[#211b16]" />
              ))}
            </div>
          ) : null}

          {extraction ? (
            <div className="mt-6 border border-emerald-300/20 bg-emerald-300/10 p-5">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-xl font-semibold tracking-tight text-zinc-50">
                  Extracted work signals
                </h3>
                <span className="border border-emerald-300/25 bg-[#0f0c09] px-3 py-1 text-xs font-semibold text-emerald-100">
                  {extraction.provider}
                </span>
              </div>
              <dl className="mt-5 grid gap-2 sm:grid-cols-2">
                {[
                  ["WiFi", extraction.wifiScore ? `${extraction.wifiScore}/5` : "Not mentioned"],
                  ["Plugs", extraction.plugScore ? `${extraction.plugScore}/5` : "Not mentioned"],
                  ["Seating", extraction.seatingScore ? `${extraction.seatingScore}/5` : "Not mentioned"],
                  ["Noise", formatExtractedNoise(extraction.noiseLevel)],
                  ["Best time", extraction.bestTime ?? "Not mentioned"],
                  ["Stay", extraction.recommendedStay ?? "Not mentioned"],
                ].map(([label, value]) => (
                  <div key={label} className="border border-white/10 bg-[#0f0c09] p-3">
                    <dt className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                      {label}
                    </dt>
                    <dd className="mt-1 text-sm font-semibold leading-5 text-zinc-100">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-sm font-medium leading-6 text-zinc-200">
                {extraction.summary}
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
