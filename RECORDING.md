# Video script: DealPilot Close (2:30, live screen recording, English)

Recording setup: browser at 1920×1080, zoom 110%, hosted demo URL (or `npm start` → http://localhost:3000). Before you start, click **Reset demo** in the top right. No music, or royalty-free only.

| Time | On screen | Voice-over (suggested) |
|---|---|---|
| 0:00–0:15 | Header and the inbox of 5 sample replies | "Exporters work hard to get a reply from a foreign buyer. Then the deal stalls: invoices in another currency, chasing payment, in another language. DealPilot Close turns that reply into a paid order." |
| 0:15–0:40 | Click **Sato Kogyo Machining** (Japanese) → **1 · Read reply with AI** | "Claude reads the Japanese reply. It understands this is a sample order, picks the right item from our catalog, prices it in yen, and drafts the answer in Japanese." Point at intent, buying signal, items table and reply draft. |
| 0:40–1:05 | **2 · Draft PayPal invoice** → invoice number appears | "With one click the agent creates a draft PayPal invoice in JPY through the Invoicing API. Nothing has gone out yet." |
| 1:05–1:20 | **3 · Approve & send** → payer link | "The sales rep stays in control. Only after approval is the invoice sent by PayPal, together with the AI's Japanese reply." |
| 1:20–1:40 | **4 · Draft reminder** | "If the buyer hasn't paid, the agent writes a polite reminder in Japanese, with the amount, due date and the PayPal link." |
| 1:40–2:00 | Open the payer link and pay as the Sandbox buyer (or **Sandbox: record payment**) → **4 · Check payment** → Won | "When the payment lands, a PayPal webhook or status check marks the deal as Won, and the pipeline updates." |
| 2:00–2:20 | Click **Hanbit Precision** (Korean) → Read → **Create payment link** | "Korean buyer, quick pilot order: the agent chooses a PayPal Orders payment link in US dollars instead." Scroll the AG Grid pipeline. |
| 2:20–2:30 | Pipeline with Won deals | "Reply to paid order, in any language, with a human in the loop. DealPilot Close: built on PayPal and Claude." |

Before recording, check:
- Both header badges are green (**AI: claude-opus-5-5**, **PayPal: Sandbox**). In demo mode they read "demo" and "simulated"; that's fine for rehearsal, not for the final video.
- AI reading takes about 10–20 seconds per reply; cut the wait in editing.
