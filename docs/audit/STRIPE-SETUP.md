# Stripe setup — get paid for audits (operator runbook, minimum manual)

> All the code is wired. This is the **only** part that needs you (Stripe is a financial account —
> the assistant never creates it or types your key). Everything is **vault-paste**, no file editing.
> Do it once in **Test mode**, prove it, then flip the same field to your **Live** key.

## What you do (≈3 minutes)

1. **Get a Stripe account** — https://dashboard.stripe.com → sign up / log in.
2. **Stay in Test mode** — top-right toggle shows **Test mode** (orange). Keep it there first.
3. **Copy your test secret key** — Developers → **API keys** → reveal **Secret key** → copy
   `sk_test_…` (NOT the publishable `pk_…`).
4. **Paste it into ollamas** — dashboard → **Revenue / Personal Ops** tab → **Get paid** card →
   paste into the **Stripe secret key** field → **Save key**. (Stored AES-256-GCM in the vault;
   it never leaves your server, never enters the assistant's context.)
5. **Make a payment link** — same card → enter **USD amount** + **description**
   (e.g. `300` · `Verified Audit — Acme repo`) → **Create payment link** → a
   `https://checkout.stripe.com/…` link appears → **send it to the client**.
   The client pays on Stripe's hosted page; the money lands in your Stripe balance.

That's the whole revenue loop: **audit → GitHub PR/Checks → this payment link → paid.**

## Go live (when a real client is ready)
Flip the dashboard toggle to **Live mode** → copy the **Live** secret key (`sk_live_…`) →
paste into the same **Stripe secret key** field → Save. New links are now real charges.
(Test links never move real money — safe to experiment.)

## Optional — automatic subscription/plan sync (only for the recurring "CI" tier)
If you sell the **Subscription** tier (per-PR / weekly CI audits), wire the webhook so Stripe
tells ollamas when a client subscribes/cancels:
1. Developers → **Webhooks** → **Add endpoint** → URL = `https://<your-public-host>/api/billing/webhook`
   (your fleet tunnel / cloudflared URL — not localhost).
2. Events: `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`.
3. Copy the **Signing secret** (`whsec_…`) → dashboard vault: save it under provider
   `stripe-webhook-secret` (same Save-key mechanism). One-time payment links (above) do **not** need this.

## Notes
- One-time audit links need **only** the secret key (step 3–5). The webhook is optional.
- Minimum charge is ~$0.50 (Stripe rule; the system clamps below that).
- Refunds / disputes / payout settings live in your Stripe dashboard — your business, your control.
- Security: the assistant builds the link; **you** create the account and paste the key. It never
  performs a transfer or types your credentials.
