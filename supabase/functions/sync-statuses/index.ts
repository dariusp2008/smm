// sync-statuses — action=status pe comenzile deschise (max 100 / apel).
// Rulează pe cron la 5 minute. Pentru comenzile parțiale întoarce diferența în sold.
// deploy: supabase functions deploy sync-statuses

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { prm4u, CORS, json } from "../_shared/prm4u.ts";

const OPEN = ["pending", "processing", "in progress", "in_progress"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: open } = await admin
    .from("orders")
    .select("id, user_id, quantity, charge, provider_order_id, status")
    .in("status", OPEN)
    .not("provider_order_id", "is", null)
    .limit(100);

  if (!open || !open.length) return json({ checked: 0 });

  let updated = 0, refunded = 0;
  try {
    const res = await prm4u({ action: "status", orders: open.map((o) => o.provider_order_id).join(",") });

    for (const o of open) {
      const info = res[o.provider_order_id!];
      if (!info || info.error) continue;

      const status = String(info.status ?? "").toLowerCase();
      const remains = Number(info.remains ?? 0);
      await admin.from("orders").update({
        status,
        remains,
        start_count: info.start_count ? Number(info.start_count) : null,
        updated_at: new Date().toISOString(),
      }).eq("id", o.id);
      updated++;

      // parțial / anulat → întoarce partea nelivrată
      if ((status === "partial" || status === "canceled" || status === "cancelled") && remains > 0) {
        const back = Number((Number(o.charge) * remains / Number(o.quantity)).toFixed(2));
        if (back > 0) {
          await admin.rpc("credit_balance", { p_user: o.user_id, p_amount: back });
          refunded++;
        }
      }
    }
  } catch (e) {
    return json({ error: String(e.message ?? e) }, 502);
  }

  return json({ checked: open.length, updated, refunded });
});
