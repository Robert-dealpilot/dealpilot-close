// Smoke test: walks every reply through the full flow against a running server (default http://localhost:3000).
const B = process.env.BASE || "http://localhost:3000";
const post = async (p, b = {}) => { const r = await fetch(B + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(p + ": " + j.error); return j; };
await post("/api/reset");
const s = await (await fetch(B + "/api/state")).json();
console.log("modes", JSON.stringify(s.modes));
for (const r of s.replies) {
  const a = await post(`/api/deals/${r.id}/analyze`);
  let line = `${r.id} ${a.analysis.language} ${a.analysis.intent} -> ${a.analysis.recommended_action} ${a.total} ${a.analysis.currency}`;
  if (a.analysis.recommended_action !== "stop") {
    const p = await post(`/api/deals/${r.id}/prepare`);
    await post(`/api/deals/${r.id}/approve`);
    const f = await post(`/api/deals/${r.id}/followup`);
    const w = await post(`/api/deals/${r.id}/simulate-payment`);
    line += ` | ${p.invoice ? "invoice " + p.invoice.number : "order " + p.order.id} | reminder ok=${!!f.followup} | stage=${w.stage}`;
  }
  console.log(line);
}
