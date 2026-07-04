import { NextResponse } from "next/server";
import { getFirstServerEnv } from "@/lib/server-env";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const name = url.searchParams.get("name");
  const width = Math.max(240, Math.min(1600, Number(url.searchParams.get("width") ?? 900)));
  const apiKey = await getFirstServerEnv("GOOGLE_MAPS_API_KEY", "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");

  if (!apiKey || !name?.startsWith("places/")) {
    return NextResponse.json({ error: "Photo unavailable" }, { status: 400 });
  }

  const photoUrl = new URL(`https://places.googleapis.com/v1/${name}/media`);
  photoUrl.searchParams.set("key", apiKey);
  photoUrl.searchParams.set("maxWidthPx", String(width));

  const response = await fetch(photoUrl, {
    next: { revalidate: 60 * 60 * 24 },
  });

  if (!response.ok || !response.body) {
    return NextResponse.json({ error: "Photo unavailable" }, { status: 502 });
  }

  return new Response(response.body, {
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "image/jpeg",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
