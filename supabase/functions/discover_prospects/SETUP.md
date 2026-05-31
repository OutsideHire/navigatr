# discover_prospects — setup & deploy

This Edge Function ingests nearby businesses from Google Places into the shared
`prospects` cache, classifies them (ICP filter), and returns the servable ones
for a rep's Path build. It runs in **mock mode** with zero cost and no API key,
so you can deploy and test the whole pipeline before the live key lands.

---

## 1. Run it now, free (mock mode)

No Google key needed. Set one secret and deploy:

```bash
supabase secrets set PLACES_MOCK=1
supabase functions deploy discover_prospects
```

In mock mode the function serves a fixed set of 6 Austin businesses
(`fixtures.ts`) that exercise every ICP branch: a clean SMB (kept), a Subway
(filtered: chain), a hotel (filtered: consumer-only), a hospital (filtered:
gov), plus two more servable SMBs. Great for wiring up the UI and verifying the
classify → store → query path end to end.

Call it:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/discover_prospects" \
  -H "Authorization: Bearer <a logged-in user's JWT>" \
  -H "Content-Type: application/json" \
  -d '{"lat":30.2672,"lng":-97.7431,"radius_m":3000}'
```

---

## 2. Going live — get a Google Places API key

> **Who does this:** whoever owns the Google Cloud billing account. The key is a
> billing credential, so it is set as a Supabase secret and **never** committed
> to the repo.

1. Go to the **Google Cloud Console** → <https://console.cloud.google.com/>.
2. Create (or pick) a project for navigatr.
3. **Enable billing** on the project — Places will not return results without an
   active billing account. (Google gives a recurring monthly free credit; our
   cached-store design keeps us well inside typical limits.)
4. Enable the API: **APIs & Services → Library → search "Places API (New)"** →
   **Enable**. ⚠️ It must be **Places API (New)**, not the legacy "Places API".
   This function calls the New `places:searchNearby` endpoint.
5. Create the key: **APIs & Services → Credentials → Create credentials → API
   key**. Copy it.
6. **Restrict the key** (strongly recommended):
   - *API restrictions* → restrict to **Places API (New)** only.
   - *Application restrictions* → leave as **None** (the call is server-side
     from Supabase's egress IPs, not a browser), or restrict by IP if you have
     Supabase's egress range.

Send the key to whoever runs the deploy. Do not paste it in Slack/email in
plaintext if you can avoid it — use a password manager share.

---

## 3. Switch to live

Set the key and turn off mock mode, then redeploy:

```bash
supabase secrets set GOOGLE_PLACES_API_KEY=<the key from step 2>
supabase secrets unset PLACES_MOCK          # or: supabase secrets set PLACES_MOCK=0
supabase functions deploy discover_prospects
```

That's it. The request/response shapes are identical to mock mode — the only
difference is real businesses and a real (small, cached) Google bill.

---

## Secrets reference

| Secret | Required | Purpose |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | live only | Places API (New) key. Omit in mock mode. |
| `PLACES_MOCK` | mock only | `1` = serve fixtures, skip Google entirely. |
| `SUPABASE_URL` | always | Auto-injected by Supabase. |
| `SUPABASE_ANON_KEY` | always | Auto-injected. Used for the user-JWT read. |
| `SUPABASE_SERVICE_ROLE_KEY` | always | Auto-injected. Writes the shared cache. |

`SUPABASE_*` are provided by the platform; you only ever set the two Places ones.

---

## Cost note

Live Places passthrough on every path build would be ~$0.45/build (~$80K/mo at
our scale). This function only calls Google for a **cold** geohash cell; a warm
cell (pulled within 30 days) is served straight from `prospects` with no Google
call. That cache is what cuts Places spend ~90%. See `PATH_DESIGN.md` §2–3.
