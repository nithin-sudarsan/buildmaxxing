import { NextResponse } from "next/server";
import { getCafePlaceDetails } from "@/lib/place-enrichment";

type CafeDetailsRouteProps = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: CafeDetailsRouteProps) {
  const { id } = await params;
  const details = await getCafePlaceDetails(id);

  if (!details) {
    return NextResponse.json({ error: "Cafe not found" }, { status: 404 });
  }

  return NextResponse.json(details);
}
