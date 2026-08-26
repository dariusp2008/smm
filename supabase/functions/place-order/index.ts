// place-order — singura cale prin care se trimite o comandă.
// Verifică JWT-ul utilizatorului, validează limitele, scade soldul, trimite
// action=add la prm4u și inserează comanda. La eroare, soldul se întoarce.
// deploy: supabase functions deploy place-order

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { prm4u, CORS, json } from "../_shared/prm4u.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const authHeader = req.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: userData } = await asUser.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: "Neautentificat." }, 401);

  const { service, link, quantity } = await req.json().catch(() => ({}));
  if (!service || !link || !quantity) return json({ error: "Parametri lipsă." }, 400);

  const { data: svc } = await admin.from("services").select("*").eq("service", service).maybeSingle();
  if (!svc || !svc.active) return json({ error: "Serviciu indisponibil." }, 400);

  const qty = Number(quantity);
  if (qty < svc.min || qty > svc.max) {
    return json({ error: `Cantitatea trebuie să fie între ${svc.min} și ${svc.max}.` }, 400);
  }

  const charge = Number((qty / 1000 * Number(svc.rate)).toFixed(2));

  const { error: debitErr } = await admin.rpc("debit_balance", { p_user: user.id, p_amount: charge });
  if (debitErr) {
    const insufficient = debitErr.message.includes("INSUFFICIENT_FUNDS");
    return json({ error: insufficient ? "Sold insuficient." : debitErr.message }, 400);
  }

  try {
    const res = await prm4u({ action: "add", service, link, quantity: qty });
    const { data: order, error: insErr } = await admin.from("orders").insert({
      user_id: user.id,
      service: svc.service,
      service_name: svc.name,
      link,
      quantity: qty,
      charge,
      status: "pending",
      provider_order_id: String(res.order),
    }).select("id").single();
    if (insErr) throw insErr;

    return json({ order_id: order.id, provider_order_id: String(res.order), charge });
  } catch (e) {
    await admin.rpc("credit_balance", { p_user: user.id, p_amount: charge });
    return json({ error: "Furnizorul a respins comanda: " + String(e.message ?? e) }, 502);
  }
});
