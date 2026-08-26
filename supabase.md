# PopularNow — backend Supabase + integrare prm4u

Frontendul (`SMM Panel.dc.html`) nu vorbește niciodată direct cu prm4u: browserul
este blocat de CORS, iar cheia API nu poate sta în cod public. Toate apelurile
trec prin funcții edge Supabase, cu cheia păstrată ca secret.

## 1. Cheile în frontend

În capul clasei de logică din `SMM Panel.dc.html`:

```js
SUPABASE_URL = "https://<project-ref>.supabase.co";
SUPABASE_ANON_KEY = "<anon key>";
```

Doar acestea două. Cheia prm4u și `service_role` nu apar niciodată în frontend.

## 2. Baza de date

```bash
supabase link --project-ref <project-ref>
supabase db push          # aplică supabase/migrations/0001_init.sql
```

Tabele: `profiles` (sold), `services` (catalog sincronizat), `orders`,
`payments`, `tickets`. RLS: fiecare utilizator citește doar rândurile lui;
`insert`/`update` pe sold și comenzi nu sunt permise din client — trec prin
funcțiile `security definer` `debit_balance` / `credit_balance`.

## 3. Secretele funcțiilor edge

```bash
supabase secrets set \
  PRM4U_API_KEY=6ab9f486b003106f4c7e1e4e9a033d02 \
  PRM4U_API_URL=https://prm4u.com/api/v2 \
  PRM4U_MARKUP=1.35 \
  PRM4U_FX_RON=4.60
```

`PRM4U_MARKUP` este marja de revânzare, `PRM4U_FX_RON` conversia din valuta
panoului furnizor în lei. Prețul afișat = `cost × FX × MARKUP`.

Cheia de mai sus este acum cunoscută public în acest fișier de proiect —
regenerează-o din panoul prm4u după prima punere în producție și păstrează noua
valoare doar în `supabase secrets`.

## 4. Funcțiile edge

```bash
supabase functions deploy sync-services
supabase functions deploy sync-statuses
supabase functions deploy place-order
supabase functions deploy order-action
```

| Funcție | Acțiune prm4u | Apelată de |
| --- | --- | --- |
| `sync-services` | `action=services` → upsert în `services`, calculează `rate` | butonul „Sincronizează din prm4u" + cron 6 h |
| `place-order` | `action=add` | butonul „Trimite comanda" (verifică JWT, scade soldul, la eroare îl întoarce) |
| `sync-statuses` | `action=status` (până la 100 comenzi) | butonul „Actualizează statusurile" + cron 5 min |
| `order-action` | `action=refill` / `cancel` / `status` | acțiuni pe o comandă |

Cron (SQL Editor, extensia `pg_cron` + `pg_net`):

```sql
select cron.schedule('sync-services', '0 */6 * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.functions.supabase.co/sync-services',
    headers := '{"Authorization":"Bearer <service_role_key>","Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb);
$$);

select cron.schedule('sync-statuses', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.functions.supabase.co/sync-statuses',
    headers := '{"Authorization":"Bearer <service_role_key>","Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb);
$$);
```

## 5. Ce lipsește pentru încasări reale

`payments` se populează, dar soldul crește doar la confirmarea plății. Este
nevoie de o funcție `payments-webhook` conectată la procesator (Stripe sau
Netopia pentru plăți în lei) care apelează `credit_balance`. Până atunci,
butonul de plată din panou doar creează înregistrarea.

## Ordinea recomandată

1. `db push` + creare cont de test
2. `secrets set` + `sync-services` → catalogul real apare în panou
3. `place-order` → prima comandă reală, cu sumă mică
4. cron `sync-statuses`
5. webhook de plăți
6. `order-action` (refill/cancel în interfață)
