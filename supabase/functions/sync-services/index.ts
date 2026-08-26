// sync-services — citește action=services de la prm4u și face upsert în tabelul `services`.
// Rulează pe cron (la 6 ore) și poate fi apelată manual din panou.
// deploy: supabase functions deploy sync-services

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { prm4u, retailRate, CORS, json } from "../_shared/prm4u.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const list = await prm4u({ action: "services" });
    if (!Array.isArray(list)) return json({ error: "Răspuns neașteptat de la furnizor." }, 502);

    const rows = list.map((s: any) => ({
      service: Number(s.service),
      name: String(s.name),
      type: s.type ?? "Default",
      category: String(s.category),
      cost: Number(s.rate),
      rate: retailRate(Number(s.rate)),
      min: Number(s.min),
      max: Number(s.max),
      refill: !!s.refill,
      cancel: !!s.cancel,
      active: true,
      synced_at: new Date().toISOString(),
    }));

    // dezactivează serviciile care au dispărut de la furnizor
    const ids = rows.map((r) => r.service);
    const { error: upErr } = await admin.from("services").upsert(rows, { onConflict: "service" });
    if (upErr) return json({ error: upErr.message }, 500);
    await admin.from("services").update({ active: false }).not("service", "in", "(" + ids.join(",") + ")");

    return json({ synced: rows.length });
  } catch (e) {
    return json({ error: String(e.message ?? e) }, 502);
  }
});
