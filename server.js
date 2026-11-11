// DealPilot Close — turns cross-border B2B buyer replies into PayPal invoices / payment links,
// with a human approval step and AI payment follow-ups. SAMPLE DATA ONLY.
import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pp from "./lib/paypal.js";
import { analyzeReply, draftFollowUp, aiConfigured, MODEL, SAMPLE_FX } from "./lib/agent.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = JSON.parse(fs.readFileSync(path.join(here, "data/sample-data.json"), "utf8"));
const STATE_FILE = path.join(here, "data/state.json");
const seller = { ...SAMPLE.seller, name: process.env.SELLER_NAME || SAMPLE.seller.name };

let deals = {};
try { deals = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch {}
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(deals, null, 2));
const log = (d, msg) => { d.activity.unshift({ at: new Date().toISOString(), msg }); };
const dealFor = (id) => {
  const reply = SAMPLE.replies.find((r) => r.id === id);
  if (!reply) throw Object.assign(new Error("Unknown reply"), { status: 404 });
  return (deals[id] ||= { id, reply, stage: "New reply", activity: [] });
};
const total = (items) => items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
const PAID = new Set(["PAID", "MARKED_AS_PAID", "COMPLETED"]);

const app = express();
app.use(express.json());
app.use(express.static(path.join(here, "public")));
const route = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)); } catch (e) { res.status(e.status || 500).json({ error: String(e.message || e) }); }
};

app.get("/api/state", route(() => ({
  seller, sampleFx: SAMPLE_FX, model: MODEL,
  modes: { ai: aiConfigured() ? "claude" : "demo", paypal: pp.paypalConfigured() ? "sandbox" : "simulated" },
  replies: SAMPLE.replies,
  deals,
})));

// 1) AI reads the reply
app.post("/api/deals/:id/analyze", route(async (req) => {
  const d = dealFor(req.params.id);
  d.analysis = await analyzeReply(d.reply, seller);
  d.total = Math.round(total(d.analysis.items) * 100) / 100;
  d.stage = d.analysis.recommended_action === "stop" ? "Closed – not interested" : "Analyzed";
  log(d, `AI read the ${d.analysis.language} reply: ${d.analysis.intent}, signal ${d.analysis.buying_signal}/100, next step: ${d.analysis.recommended_action}.`);
  save(); return d;
}));

// 2) Agent prepares the PayPal document (draft — nothing is sent yet)
app.post("/api/deals/:id/prepare", route(async (req) => {
  const d = dealFor(req.params.id);
  if (!d.analysis) throw new Error("Analyze the reply first.");
  const a = d.analysis;
  if (!a.items.length) throw new Error("No billable items for this reply.");
  const kind = req.body?.kind || (a.recommended_action === "payment_link" ? "payment_link" : "invoice");
  if (kind === "invoice") {
    if (pp.paypalConfigured()) {
      const inv = await pp.createDraftInvoice({
        currency: a.currency, items: a.items, sellerName: seller.name,
        buyer: { name: d.reply.from_name, email: d.reply.from_email },
        note: `Thank you, ${d.reply.from_company}. Sample data — DealPilot Close demo.`,
      });
      d.invoice = { id: inv.id, number: inv.detail?.invoice_number, status: inv.status, due_date: inv.detail?.payment_term?.due_date };
    } else {
      d.invoice = { id: `SIM-INV-${Date.now()}`, number: `SIM-${String(Date.now()).slice(-5)}`, status: "DRAFT", simulated: true };
    }
    log(d, `Draft PayPal invoice ${d.invoice.number} created for ${d.total} ${a.currency} (not sent).`);
  } else {
    const base = `${req.protocol}://${req.get("host")}`;
    if (pp.paypalConfigured()) {
      const o = await pp.createPaymentLink({
        currency: a.currency, amount: d.total, description: `${seller.name} – ${a.items.map((i) => i.sku).join(", ")}`,
        returnUrl: `${base}/paypal/return?deal=${d.id}`, cancelUrl: `${base}/?cancelled=${d.id}`,
      });
      d.order = { id: o.id, status: o.status, approve_url: o.approveUrl };
    } else {
      d.order = { id: `SIM-ORDER-${Date.now()}`, status: "CREATED", approve_url: `${base}/?simulated-pay=${d.id}`, simulated: true };
    }
    log(d, `PayPal payment link (Orders v2) created for ${d.total} ${a.currency} (not sent).`);
  }
  d.stage = "Awaiting approval";
  save(); return d;
}));

// 3) Human approval: only now is the invoice sent / the reply marked as sent
app.post("/api/deals/:id/approve", route(async (req) => {
  const d = dealFor(req.params.id);
  if (d.invoice && d.invoice.status === "DRAFT") {
    if (!d.invoice.simulated) {
      const s = await pp.sendInvoice(d.invoice.id);
      const inv = await pp.getInvoice(d.invoice.id);
      d.invoice.status = inv.status;
      d.invoice.payer_link = s.payerLink || inv.detail?.metadata?.recipient_view_url;
      d.invoice.due_date = inv.detail?.payment_term?.due_date || d.invoice.due_date;
    } else { d.invoice.status = "SENT"; d.invoice.payer_link = "(simulated)"; }
    log(d, `Rep approved. Invoice ${d.invoice.number} sent via PayPal; AI reply (${d.analysis.language}) marked as sent.`);
  } else if (d.order) {
    log(d, `Rep approved. Payment link and AI reply (${d.analysis.language}) marked as sent.`);
  } else if (d.analysis) {
    log(d, `Rep approved the AI reply (${d.analysis.language}).`);
  }
  d.approved_at = new Date().toISOString();
  d.stage = d.invoice || d.order ? "Waiting for payment" : "Replied";
  save(); return d;
}));

// 4) Track payment: poll PayPal (webhooks also update this — see /api/webhooks/paypal)
app.post("/api/deals/:id/refresh", route(async (req) => {
  const d = dealFor(req.params.id);
  if (d.invoice && !d.invoice.simulated) d.invoice.status = (await pp.getInvoice(d.invoice.id)).status;
  if (d.order && !d.order.simulated) d.order.status = (await pp.getOrder(d.order.id)).status;
  const status = d.invoice?.status || d.order?.status;
  if (PAID.has(status)) markWon(d, "PayPal reports payment received");
  else log(d, `Checked PayPal: ${status}.`);
  save(); return d;
}));

// 4b) Not paid yet -> AI drafts a reminder in the buyer's language (rep still approves it)
app.post("/api/deals/:id/followup", route(async (req) => {
  const d = dealFor(req.params.id);
  d.followup = await draftFollowUp(d);
  log(d, `AI drafted a payment reminder in ${d.analysis.language}.`);
  save(); return d;
}));

// Sandbox helper so the demo can show the PAID path without logging in as the buyer
app.post("/api/deals/:id/simulate-payment", route(async (req) => {
  const d = dealFor(req.params.id);
  if (d.invoice && !d.invoice.simulated) {
    await pp.recordPayment(d.invoice.id, { amount: d.total, currency: d.analysis.currency });
    d.invoice.status = (await pp.getInvoice(d.invoice.id)).status;
  } else if (d.invoice) d.invoice.status = "MARKED_AS_PAID";
  else if (d.order) d.order.status = "COMPLETED";
  markWon(d, "Sandbox payment recorded");
  save(); return d;
}));

function markWon(d, why) {
  if (d.stage === "Won") return;
  d.stage = "Won"; d.won_at = new Date().toISOString();
  log(d, `${why}. Deal marked Won (${d.total} ${d.analysis.currency}); pipeline updated.`);
}

// Buyer returns from PayPal checkout (Orders v2) -> capture
app.get("/paypal/return", async (req, res) => {
  const d = deals[req.query.deal];
  try {
    if (d?.order && !d.order.simulated) {
      const c = await pp.captureOrder(req.query.token || d.order.id);
      d.order.status = c.status;
      if (PAID.has(c.status)) markWon(d, "Buyer paid via PayPal checkout");
      save();
    }
  } catch (e) { if (d) { log(d, `Capture failed: ${e.message}`); save(); } }
  res.redirect("/?paid=" + encodeURIComponent(req.query.deal || ""));
});

// PayPal webhooks: INVOICING.INVOICE.PAID, PAYMENT.CAPTURE.COMPLETED
app.post("/api/webhooks/paypal", route(async (req) => {
  const ev = req.body;
  const ok = await pp.verifyWebhook(req.headers, ev).catch(() => false);
  if (!ok) return { received: true, verified: false };
  const resId = ev.resource?.id || ev.resource?.invoice?.id;
  const d = Object.values(deals).find((x) => x.invoice?.id === resId || x.order?.id === resId ||
    x.order?.id === ev.resource?.supplementary_data?.related_ids?.order_id);
  if (d && /INVOICE.PAID|CAPTURE.COMPLETED/.test(ev.event_type)) {
    if (d.invoice) d.invoice.status = "PAID"; if (d.order) d.order.status = "COMPLETED";
    markWon(d, `Webhook ${ev.event_type}`); save();
  }
  return { received: true, verified: true };
}));

app.post("/api/reset", route(() => { deals = {}; save(); return { ok: true }; }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`DealPilot Close on http://localhost:${port}  (AI: ${aiConfigured() ? MODEL : "demo"}, PayPal: ${pp.paypalConfigured() ? "sandbox" : "simulated"})`));
