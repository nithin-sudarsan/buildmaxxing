import { getFirstServerEnv } from "./server-env";

type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function callOpenRouterJson<T>(
  messages: OpenRouterMessage[],
): Promise<T | null> {
  const apiKey = await getFirstServerEnv("OPENROUTER_API_KEY");
  if (!apiKey) return null;
  const siteUrl = await getFirstServerEnv("NEXT_PUBLIC_SITE_URL");
  const model = await getFirstServerEnv("OPENROUTER_MODEL");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": siteUrl ?? "http://localhost:3000",
      "X-Title": "BuildMaxxing",
    },
    body: JSON.stringify({
      model: model ?? "openai/gpt-4o-mini",
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) return null;

  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}
