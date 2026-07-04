import { redirect } from "next/navigation";

type FeedbackPageProps = {
  searchParams: Promise<{ cafe?: string }>;
};

export default async function FeedbackPage({ searchParams }: FeedbackPageProps) {
  const params = await searchParams;
  const cafeParam = params.cafe ? encodeURIComponent(params.cafe) : "1";
  redirect(`/?feedback=${cafeParam}`);
}
