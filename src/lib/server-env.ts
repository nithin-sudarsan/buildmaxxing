import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function getServerEnv(name: string) {
  const processValue = process.env[name];
  if (processValue) return processValue;

  try {
    const { env } = await getCloudflareContext({ async: true });
    const bindingValue = (env as Record<string, unknown>)[name];
    return typeof bindingValue === "string" && bindingValue.length > 0
      ? bindingValue
      : undefined;
  } catch {
    return undefined;
  }
}

export async function getFirstServerEnv(...names: string[]) {
  for (const name of names) {
    const value = await getServerEnv(name);
    if (value) return value;
  }

  return undefined;
}
