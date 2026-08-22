/** Fetch avec timeout court et User-Agent identifiable (règle §2.9). */
export const USER_AGENT = "ProspectionIA/1.0 (outil de prospection B2B; contact via .env MAIL_FROM_ADDRESS)";

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "User-Agent": USER_AGENT, ...init.headers },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${url} — ${body.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
