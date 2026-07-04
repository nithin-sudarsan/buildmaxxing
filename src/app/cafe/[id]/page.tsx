import { notFound, redirect } from "next/navigation";
import { getCafeById } from "@/lib/cafes";

type CafePageProps = {
  params: Promise<{ id: string }>;
};

export default async function CafePage({ params }: CafePageProps) {
  const { id } = await params;
  const cafe = getCafeById(id);
  if (!cafe) notFound();
  redirect(`/?cafe=${cafe.id}`);
}
