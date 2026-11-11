// PayPal REST (Sandbox) client: OAuth, Invoicing v2, Orders v2, webhook signature verification.
// Docs: https://developer.paypal.com/docs/api/invoicing/v2/ , /orders/v2/ , /webhooks/v1/
const BASE = () => process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com";
export const paypalConfigured = () => Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);

// Currencies PayPal accepts without decimals
const ZERO_DECIMAL = new Set(["JPY", "TWD", "HUF"]);
export const fmtAmount = (value, currency) =>
  ZERO_DECIMAL.has(currency) ? String(Math.round(Number(value))) : Number(value).toFixed(2);

let cached = { token: null, exp: 0 };
async function token() {
  if (cached.token && Date.now() < cached.exp - 60_000) return cached.token;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const r = await fetch(`${BASE()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`PayPal OAuth failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

async function call(method, path, body, extraHeaders = {}) {
  const r = await fetch(`${BASE()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const json = text ? JSON.parse(text) : {};
  if (!r.ok) {
    const msg = json.message || json.error_description || text;
    const details = json.details ? " " + JSON.stringify(json.details).slice(0, 400) : "";
    throw new Error(`PayPal ${method} ${path} -> ${r.status}: ${msg}${details}`);
  }
  return json;
}

// ---- Invoicing v2 ----
export async function nextInvoiceNumber() {
  const j = await call("POST", "/v2/invoicing/generate-next-invoice-number");
  return j.invoice_number;
}

/** Create a DRAFT invoice. items: [{name, quantity, unit_price}] in `currency`. */
export async function createDraftInvoice({ currency, items, buyer, note, sellerName }) {
  const invoice_number = await nextInvoiceNumber();
  const today = new Date().toISOString().slice(0, 10);
  const recipientEmail = process.env.PAYPAL_SANDBOX_BUYER_EMAIL || buyer.email;
  const [given, ...rest] = String(buyer.name || "Buyer").split(" ");
  const body = {
    detail: {
      invoice_number,
      invoice_date: today,
      currency_code: currency,
      note: note?.slice(0, 4000),
      memo: "Created by DealPilot Close (sample data)",
      payment_term: { term_type: "NET_10" },
    },
    invoicer: { business_name: sellerName },
    primary_recipients: [
      {
        billing_info: {
          name: { given_name: given, surname: rest.join(" ") || "-" },
          email_address: recipientEmail,
        },
      },
    ],
    items: items.map((it) => ({
      name: it.name.slice(0, 200),
      quantity: String(it.quantity),
      unit_amount: { currency_code: currency, value: fmtAmount(it.unit_price, currency) },
      unit_of_measure: "QUANTITY",
    })),
    configuration: { allow_tip: false, tax_calculated_after_discount: true, tax_inclusive: false },
  };
  return call("POST", "/v2/invoicing/invoices", body);
}

/** Send a draft invoice to the recipient (the "approve" step). Returns the payer link. */
export async function sendInvoice(id) {
  const j = await call("POST", `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: true, send_to_invoicer: false });
  const payerLink = (j.links || []).find((l) => l.rel === "payer-view")?.href || j.href || null;
  return { raw: j, payerLink };
}

export const getInvoice = (id) => call("GET", `/v2/invoicing/invoices/${id}`);

/** Sandbox helper: record an external payment so the demo can show the PAID path without a buyer login. */
export async function recordPayment(id, { amount, currency }) {
  return call("POST", `/v2/invoicing/invoices/${id}/payments`, {
    method: "BANK_TRANSFER",
    payment_date: new Date().toISOString().slice(0, 10),
    amount: { currency_code: currency, value: fmtAmount(amount, currency) },
    note: "Recorded in sandbox by DealPilot Close demo",
  });
}

// ---- Orders v2 (payment link for deposits / small orders) ----
export async function createPaymentLink({ currency, amount, description, returnUrl, cancelUrl }) {
  const j = await call("POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [{ amount: { currency_code: currency, value: fmtAmount(amount, currency) }, description: description.slice(0, 127) }],
    payment_source: {
      paypal: {
        experience_context: {
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      },
    },
  });
  const approve = (j.links || []).find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  return { id: j.id, status: j.status, approveUrl: approve };
}
export const getOrder = (id) => call("GET", `/v2/checkout/orders/${id}`);
export const captureOrder = (id) => call("POST", `/v2/checkout/orders/${id}/capture`, {});

// ---- Webhooks ----
export async function verifyWebhook(headers, event) {
  if (!process.env.PAYPAL_WEBHOOK_ID) return false;
  const j = await call("POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: headers["paypal-auth-algo"],
    cert_url: headers["paypal-cert-url"],
    transmission_id: headers["paypal-transmission-id"],
    transmission_sig: headers["paypal-transmission-sig"],
    transmission_time: headers["paypal-transmission-time"],
    webhook_id: process.env.PAYPAL_WEBHOOK_ID,
    webhook_event: event,
  });
  return j.verification_status === "SUCCESS";
}
