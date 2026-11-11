# DealPilot Close

**From buyer reply to paid order. An AI agent built on PayPal and Claude, with a human approving every step.**

## Judges: quick test (about 3 minutes)

Open the hosted demo: _(URL)_. The header badges should read **AI: claude-opus-5-5** and **PayPal: Sandbox**.

1. Click **Sato Kogyo Machining (sample)**. The reply is in Japanese.
2. Click **1 · Read reply with AI**. In about 10–20 seconds you'll see the intent, the buying signal, the sample kit priced in **JPY**, and a reply draft in Japanese.
3. Click **2 · Draft PayPal invoice**. A real **draft** invoice is created in our PayPal Sandbox, and the invoice number appears.
4. Click **3 · Approve & send**. PayPal sends the invoice, and an **open payer link** appears.
5. Pay it in one of two ways:
   - **As the buyer:** open the payer link and log in with the Sandbox buyer account `_(sandbox buyer email)_` / `_(password)_` (test account, no real money).
   - **Quick path:** click **Sandbox: record payment**.
6. Click **4 · Check payment**. The status turns **PAID / MARKED_AS_PAID**, and the deal shows **Won** in the pipeline below within a few seconds. Before payment, **4 · Draft reminder** shows the AI's Japanese payment reminder.

Try the other replies as well: the Korean one gets a **payment link** (Orders v2) in USD, the Chinese one a USD invoice, and the German one an EUR invoice. The English "not interested" reply is closed without any invoice.

Cross-border B2B exporters spend weeks winning a reply to their outreach. Then the deal stalls at the step that should be easiest: sample orders, pilot orders and first orders need a quote, an invoice in the buyer's currency and payment follow-ups, often in Japanese, Korean, Chinese or German. DealPilot Close turns that reply into a paid order:

1. **Read**: Claude reads the buyer's reply in any language. It detects intent (sample, pilot or first order, quote request, not interested), scores the buying signal, maps the request to the seller's catalog and converts prices into the buyer's currency.
2. **Prepare**: the agent drafts a **PayPal invoice** (Invoicing v2) or a **PayPal payment link** (Orders v2), plus a reply email in the buyer's own language. Nothing is sent yet.
3. **Approve**: the sales rep reviews and clicks **Approve & send**. Only then is the PayPal invoice sent.
4. **Track and follow up**: payment status comes from PayPal (webhooks or polling). If the buyer hasn't paid, Claude drafts a polite reminder in the buyer's language. When the buyer pays, the deal is marked **Won** and the pipeline (AG Grid) updates.

> All companies, people and emails in the demo are fictional (**sample data**).

## Demo

- Hosted demo: _(added after deployment)_
- Video: _(YouTube link)_

## How it uses PayPal

| Step | PayPal API |
|---|---|
| Authenticate | `POST /v1/oauth2/token` (client credentials, Sandbox) |
| Invoice number | `POST /v2/invoicing/generate-next-invoice-number` |
| Draft invoice in the buyer's currency (JPY, USD, EUR…) | `POST /v2/invoicing/invoices` |
| Send after human approval | `POST /v2/invoicing/invoices/{id}/send` |
| Track payment | `GET /v2/invoicing/invoices/{id}` and webhook `INVOICING.INVOICE.PAID` |
| Sandbox demo of the paid path | `POST /v2/invoicing/invoices/{id}/payments` (record payment) |
| Payment link for quick deposits | `POST /v2/checkout/orders` → buyer approves → `POST /v2/checkout/orders/{id}/capture` |
| Webhook security | `POST /v1/notifications/verify-webhook-signature` |

## How it uses AI

- **Model**: Anthropic **Claude Opus 5.5** (`claude-opus-5-5`) through the official `@anthropic-ai/sdk` (Messages API).
- **Structured outputs** (`output_config.format` JSON Schema): every analysis returns typed fields (language, intent, buying signal, catalog items with quantities and converted prices, recommended action, and the reply subject and body in the buyer's language). The server can therefore call PayPal with validated data instead of free text.
- **Guardrails**: the agent may only use catalog SKUs and the provided FX table, and it never sends anything. Every outbound action waits for the rep's approval. A server-side refusal fallback (`fallbacks: "default"`) keeps the flow working if a request is declined.
- **Payment reminders**: a second structured call writes the reminder in the buyer's language, quoting the invoice number, amount, due date and PayPal link.
- **Demo mode**: without an `ANTHROPIC_API_KEY`, the app returns clearly labelled canned results so judges can still click through.
- AI tools used to build this project: Claude (Claude Code) assisted with writing code and docs.

## Run it locally

Requirements: Node.js 20+.

```bash
git clone <this repo>
cd dealpilot-close
npm install
cp .env.example .env      # then fill in the values below
npm start                 # http://localhost:3000
```

`.env` values:

| Variable | Where to get it |
|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | developer.paypal.com → Apps & Credentials → **Sandbox** → create app |
| `PAYPAL_SANDBOX_BUYER_EMAIL` | developer.paypal.com → Sandbox accounts → a **Personal** account (invoices are addressed to it, so you can pay them) |
| `PAYPAL_WEBHOOK_ID` (optional) | your Sandbox app → Webhooks → add `https://<your-host>/api/webhooks/paypal` with `INVOICING.INVOICE.PAID` and `PAYMENT.CAPTURE.COMPLETED` |
| `ANTHROPIC_API_KEY` | console.anthropic.com |

Without PayPal keys the app runs in **simulated** mode (fake invoice ids, labelled in the header). Without an Anthropic key, it runs in **AI demo mode**.

### Try the flow
1. Pick a reply on the left (Japanese, Korean, Chinese, German or English).
2. **1 · Read reply with AI**: see intent, buying signal, priced items and the reply draft in the buyer's language.
3. **2 · Draft PayPal invoice** or **2 · Create payment link**: a draft is created in your PayPal Sandbox.
4. **3 · Approve & send**: the invoice is sent from the Sandbox (open the payer link to pay as the Sandbox buyer).
5. **4 · Check payment** / **4 · Draft reminder**. To finish the demo without logging in as the buyer, click **Sandbox: record payment**. The deal becomes **Won** in the pipeline.

`npm run check` runs every sample reply through the whole flow against a running server.

## Tech
Node.js + Express · PayPal REST (Sandbox) · Anthropic Claude (`@anthropic-ai/sdk`) · AG Grid Community (pipeline table) · no database (JSON state file).

## License
MIT
