"use client";

import {
  ArrowRight,
  BatteryCharging,
  Chair,
  Laptop,
  Star,
  WifiHigh,
} from "@phosphor-icons/react";
import Image from "next/image";
import type { Cafe } from "@/lib/types";
import { calculateWorkScore, formatNoise, getWorkScoreLabel, scoreTone } from "@/lib/scoring";

type CafeCardProps = {
  cafe: Cafe;
  onSelect?: (cafe: Cafe) => void;
};

export function CafeCard({ cafe, onSelect }: CafeCardProps) {
  const score = calculateWorkScore(cafe);

  return (
    <article className="group overflow-hidden rounded-[1.35rem] border border-zinc-200 bg-white shadow-[0_16px_60px_rgba(24,24,27,0.07)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_70px_rgba(24,24,27,0.12)] dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
      <button
        type="button"
        onClick={() => onSelect?.(cafe)}
        className="block w-full text-left"
        aria-label={`View ${cafe.name}`}
      >
        <div className="relative aspect-[4/3] overflow-hidden bg-zinc-200 dark:bg-zinc-800">
          <Image
            src={cafe.imageUrl}
            alt={cafe.imageAlt}
            fill
            unoptimized
            sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
            className="object-cover transition duration-500 group-hover:scale-[1.04]"
          />
        </div>
        <div className="space-y-5 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                {cafe.area}
              </p>
              <h3 className="mt-1 text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                {cafe.name}
              </h3>
            </div>
            <div className="text-right">
              <p className={`text-3xl font-semibold tracking-tight ${scoreTone(score)}`}>
                {score}
              </p>
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                work score
              </p>
            </div>
          </div>

          <p className="line-clamp-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
            {cafe.workSummary}
          </p>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <span className="flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-2 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              <WifiHigh size={16} weight="bold" />
              WiFi {cafe.wifiScore}/5
            </span>
            <span className="flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-2 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              <BatteryCharging size={16} weight="bold" />
              Plugs {cafe.plugScore}/5
            </span>
            <span className="flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-2 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              <Chair size={16} weight="bold" />
              Seats {cafe.seatingScore}/5
            </span>
            <span className="flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-2 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              <Laptop size={16} weight="bold" />
              {formatNoise(cafe.noiseLevel)}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {cafe.bestFor.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200"
              >
                {tag}
              </span>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <span className="flex items-center gap-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-300">
              <Star size={16} weight="fill" className="text-emerald-600 dark:text-emerald-300" />
              {cafe.rating} from {cafe.reviewCount} seed reviews
            </span>
            <span className="flex items-center gap-1 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
              {getWorkScoreLabel(score)}
              <ArrowRight size={16} weight="bold" />
            </span>
          </div>
        </div>
      </button>
    </article>
  );
}
