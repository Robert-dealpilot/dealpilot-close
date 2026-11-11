// The AI part of DealPilot Close: Claude reads a buyer's reply (any language), decides the commercial next step,
// prices the order from the seller's catalog, and drafts the reply / payment reminder in the buyer's language.
// Uses the Anthropic TypeScript/JS SDK with structured JSON output (output_config.format) and server-side refusal fallback.
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";
export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);
const client = () => new Anthropic();

// Sample FX table used to convert catalog USD prices (shown in the UI as sample rates).
export const SAMPLE_FX = { USD: 1, EUR: 0.92, JPY: 150, TWD: 32, GBP: 0.79, SGD: 1.35, AUD: 1.52 };
// Currencies PayPal Invoicing supports that we allow; anything else (e.g. KRW, MYR) falls back to USD.
const ALLOWED = Object.keys(SAMPLE_FX);

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["language", "intent", "buying_signal", "summary_en", "currency", "items", "recommended_action", "reply_subject", "reply_body", "reasoning_en"],
  properties: {
    language: { type: "string", description: "BCP-47 code of the buyer's language, e.g. ja, ko, zh-Hant, en, de" },
    intent: { type: "string", enum: ["sample_order", "pilot_order", "first_order", "quote_request", "not_interested", "other"] },
    buying_signal: { type: "integer", description: "0-100 likelihood the buyer pays this week" },
    summary_en: { type: "string", description: "One-sentence English summary for the sales rep" },
    currency: { type: "string", enum: ALLOWED },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sku", "name", "quantity", "unit_price"],
        properties: {
          sku: { type: "string" },
          name: { type: "string" },
          quantity: { type: "integer" },
          unit_price: { type: "number", description: "Unit price converted into `currency` with the sample FX table" },
        },
      },
    },
    recommended_action: { type: "string", enum: ["invoice", "payment_link", "reply_only", "stop"] },
    reply_subject: { type: "string" },
    reply_body: { type: "string", description: "Reply to the buyer, written in the buyer's language" },
    reasoning_en: { type: "string", description: "Short English reason for the recommended action" },
  },
};

const FOLLOWUP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: { subject: { type: "string" }, body: { type: "string" } },
};

async function structured(system, user, schema) {
  const response = await client().beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: user }],
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined this request.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

const SYSTEM_ANALYZE = `You are the closing assistant of a B2B export sales team.
A buyer has replied to a cold email. Read the reply (any language) and decide the next commercial step.
Rules:
- Use ONLY products from the seller catalog; map the buyer's words to catalog SKUs. Never invent products or discounts.
- Convert catalog USD prices into the buyer's preferred currency with the given sample FX table. If the buyer's currency is not in the table, use USD.
- recommended_action: "invoice" for samples, pilot or first orders with clear items and quantities; "payment_link" when the buyer asks for a quick pay link or a deposit; "reply_only" when you need more information (e.g. a quote request without quantities - still list the likely items); "stop" when the buyer is not interested (items empty).
- reply_body: polite, concise business email in the buyer's language, signed "Robert, Deal Pilot sales". Mention that an invoice/payment link follows when applicable. If the buyer opts out, confirm removal politely.`;

export async function analyzeReply(reply, seller) {
  if (!aiConfigured()) return mockAnalyze(reply, seller);
  const user = `Seller: ${seller.name} (${seller.country})
Catalog (USD): ${JSON.stringify(seller.catalog)}
Sample FX per 1 USD: ${JSON.stringify(SAMPLE_FX)}

Buyer: ${reply.from_name}, ${reply.from_company}, ${reply.country}
Subject: ${reply.subject}
Reply:
${reply.body}`;
  return structured(SYSTEM_ANALYZE, user, ANALYSIS_SCHEMA);
}

const SYSTEM_FOLLOWUP = `You write payment reminders for a B2B export sales team. Write in the buyer's language, short, warm and specific:
mention the invoice number, amount and due date, offer help with payment, and include the payment link exactly as given. Sign "Robert, Deal Pilot sales".`;

export async function draftFollowUp(deal) {
  if (!aiConfigured()) return mockFollowUp(deal);
  const user = `Buyer: ${deal.reply.from_name}, ${deal.reply.from_company}
Language: ${deal.analysis.language}
Invoice number: ${deal.invoice?.number}
Amount: ${deal.total} ${deal.analysis.currency}
Due: ${deal.invoice?.due_date || "10 days after invoice date"}
Payment link: ${deal.invoice?.payer_link || deal.order?.approve_url}`;
  return structured(SYSTEM_FOLLOWUP, user, FOLLOWUP_SCHEMA);
}

// ---------- Demo mode (no API key): deterministic, clearly labelled ----------
function mockAnalyze(reply, seller) {
  const by = (sku) => seller.catalog.find((c) => c.sku === sku);
  const conv = (usd, cur) => Math.round(usd * SAMPLE_FX[cur] * 100) / 100;
  const presets = {
    r1: { language: "ja", intent: "sample_order", currency: "JPY", items: [["SAMPLE-KIT", 1]], action: "invoice", signal: 85,
      subject: "Re: 超硬エンドミルのご案内｜サンプルキットのご請求書", body: "佐藤様\n\nご返信ありがとうございます。サンプルキット1セットの請求書（円建て）を別途PayPalでお送りいたします。お試しいただいた後、6mmエンドミル200本のお見積りもご用意いたします。\n\nRobert, Deal Pilot sales" },
    r2: { language: "ko", intent: "pilot_order", currency: "USD", items: [["TH-BT40", 20]], action: "payment_link", signal: 80,
      subject: "Re: BT40 툴홀더 결제 링크", body: "박민준 님,\n\n답장 감사합니다. BT40 툴홀더 20개에 대한 미국 달러 결제 링크를 보내드립니다. 결제 확인 후 바로 출고를 준비하겠습니다.\n\nRobert, Deal Pilot sales" },
    r3: { language: "zh-Hant", intent: "first_order", currency: "USD", items: [["CL-ER32", 5]], action: "invoice", signal: 75,
      subject: "Re: ER32 夾頭組首單發票", body: "陳先生您好，\n\n感謝回覆。ER32 夾頭組 5 套的美元發票將透過 PayPal 寄出，付款期限為 10 天。如需任何協助，請隨時告訴我。\n\nRobert, Deal Pilot sales" },
    r4: { language: "de", intent: "quote_request", currency: "EUR", items: [["EM-10-ST", 50]], action: "invoice", signal: 60,
      subject: "Re: Hartmetallfräser 10mm – Pilotauftrag", body: "Sehr geehrte Frau Becker,\n\nvielen Dank für Ihre Antwort. Anbei folgt die Rechnung in EUR für 50 Stück 10-mm-Fräser als Pilotauftrag über PayPal.\n\nRobert, Deal Pilot sales" },
    r5: { language: "en", intent: "not_interested", currency: "USD", items: [], action: "stop", signal: 0,
      subject: "Re: Tooling from Taiwan", body: "Hi James,\n\nUnderstood, thank you for letting us know. We have removed you from our list.\n\nRobert, Deal Pilot sales" },
  };
  const p = presets[reply.id] || presets.r3;
  return {
    language: p.language, intent: p.intent, buying_signal: p.signal,
    summary_en: `[demo mode] ${p.intent.replace("_", " ")} from ${reply.from_company}`,
    currency: p.currency,
    items: p.items.map(([sku, q]) => ({ sku, name: by(sku).name, quantity: q, unit_price: conv(by(sku).unit_price_usd, p.currency) })),
    recommended_action: p.action, reply_subject: p.subject, reply_body: p.body,
    reasoning_en: "[demo mode] Add ANTHROPIC_API_KEY to let Claude read the reply.",
  };
}
function mockFollowUp(deal) {
  return {
    subject: `Payment reminder: invoice ${deal.invoice?.number || ""}`,
    body: `[demo mode] Friendly reminder that invoice ${deal.invoice?.number || ""} (${deal.total} ${deal.analysis.currency}) is waiting for payment: ${deal.invoice?.payer_link || deal.order?.approve_url || ""}\n\nRobert, Deal Pilot sales`,
  };
}
