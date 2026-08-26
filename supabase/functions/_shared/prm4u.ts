// Client PRM4U partajat de toate funcțiile edge.
// Cheia stă în secretele Supabase: PRM4U_API_KEY. Nu ajunge niciodată în browser.

const API_URL = Deno.env.get("PRM4U_API_URL") ?? "https://prm4u.com/api/v2";
const API_KEY = Deno.env.get("PRM4U_API_KEY")!;

export const MARKUP = Number(Deno.env.get("PRM4U_MARKUP") ?? "1.35");
export const FX = Number(Deno.env.get("PRM4U_FX_RON") ?? "1"); // valuta prm4u → lei

export class Prm4uError extends Error {}

export async function prm4u(params: Record<string, unknown>) {
  const body = new URLSearchParams(
    Object.entries({ ...params, key: API_KEY })
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, String(v)]),
  ).toString();

  const resp = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "PopularNow/1.0",
    },
    body,
  });

  const text = await resp.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Prm4uError("Răspuns invalid: " + text.slice(0, 200)); }

  if (data && typeof data === "object" && !Array.isArray(data) && (data as any).error) {
    throw new Prm4uError(String((data as any).error));
  }
  return data as any;
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Preț de revânzare, în lei, la 1.000 de unități.
export const retailRate = (cost: number) => Number((cost * FX * MARKUP).toFixed(4));
