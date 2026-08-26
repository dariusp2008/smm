// order-action — refill / cancel / status pentru o comandă a utilizatorului autentificat.
// deploy: supabase functions deploy order-action

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { prm4u, CORS, json } from "../_shared/prm4u.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: userData } = await asUser.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: "Neautentificat." }, 401);

  const { order_id, action } = await req.json().catch(() => ({}));
  if (!order_id || !["refill", "cancel", "status"].includes(action)) {
    return json({ error: "Acțiune invalidă." }, 400);
  }

  const { data: order } = await admin
    .from("orders").select("id, provider_order_id, user_id, status")
    .eq("id", order_id).eq("user_id", user.id).maybeSingle();
  if (!order || !order.provider_order_id) return json({ error: "Comandă inexistentă." }, 404);

  try {
    if (action === "refill") {
      const res = await prm4u({ action: "refill", order: order.provider_order_id });
      return json({ refill: res.refill });
    }
    if (action === "cancel") {
      const res = await prm4u({ action: "cancel", orders: order.provider_order_id });
      await admin.from("orders").update({ status: "canceled" }).eq("id", order.id);
      return json({ result: res });
    }
    const res = await prm4u({ action: "status", order: order.provider_order_id });
    return json({ status: res.status, remains: res.remains, start_count: res.start_count });
  } catch (e) {
    return json({ error: String(e.message ?? e) }, 502);
  }
});
