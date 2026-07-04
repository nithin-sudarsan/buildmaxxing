import { NextResponse } from "next/server";
import { getExpandedCafes } from "@/lib/google-cafes";

export async function GET() {
  const cafes = await getExpandedCafes();

  return NextResponse.json({
    cafes,
    count: cafes.length,
    provider: cafes.some((cafe) => cafe.source === "google") ? "google_places" : "seed_fallback",
  });
}
