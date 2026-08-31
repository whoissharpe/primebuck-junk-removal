// POST /api/lead — admin-only manual lead entry, for leads that came in by
// phone, text, referral, etc. rather than through the website form.
// Protected by the same Basic Auth as /admin.
//
// "Website" is NOT an allowed source here — that value is reserved for
// leads inserted by /api/submit itself, so it can't be spoofed by picking
// it from this form.
//
// Requires the `source` column — see the migration note in
// functions/admin/index.js.

import { requireAuth } from "../_lib/auth.js";

const ALLOWED_SOURCES = [
  "Phone call",
  "Text",
  "Referral",
  "Facebook",
  "Instagram",
  "Google",
  "Walk-in",
  "Other",
];

export async function onRequestPost(context) {
  const { request, env } = context;

  const unauthorized = requireAuth(request, env);
  if (unauthorized) return unauthorized;

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const name = clean(data.name, 120);
  const phone = clean(data.phone, 40);
  const email = clean(data.email, 200);
  const message = clean(data.message, 2000);
  const notes = clean(data.notes, 2000);
  const smsConsent = data.smsConsent ? 1 : 0;
  const source = clean(data.source, 40);
  const receivedAt = parseReceivedAt(data.receivedAt);

  if (!name || !phone || !message) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "invalid_email" }, 400);
  }
  if (!ALLOWED_SOURCES.includes(source)) {
    return json({ ok: false, error: "invalid_source" }, 400);
  }

  function buildInsert(includeNotes) {
    const cols = ["name", "phone", "email", "message", "sms_consent", "source"];
    const vals = [name, phone, email || "", message, smsConsent, source];
    if (includeNotes) { cols.push("notes"); vals.push(notes || null); }
    if (receivedAt) { cols.push("created_at"); vals.push(receivedAt); }
    const placeholders = cols.map(() => "?").join(", ");
    return env.DB.prepare(`INSERT INTO leads (${cols.join(", ")}) VALUES (${placeholders})`).bind(...vals);
  }

  try {
    let result;
    try {
      result = await buildInsert(true).run();
    } catch (err) {
      // Fallback for schemas without the `notes` column yet.
      result = await buildInsert(false).run();
    }
    const id = result && result.meta && result.meta.last_row_id;
    return json({ ok: true, id: id });
  } catch (err) {
    return json({ ok: false, error: "db_error", message: String((err && err.message) || err) }, 500);
  }
}

// Accepts an ISO datetime string from the client and converts it to the
// "YYYY-MM-DD HH:MM:SS" UTC format used elsewhere in this table.
// Returns null if not provided or unparseable (caller then omits it,
// letting the column's own default — the current time — apply).
function parseReceivedAt(v) {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function clean(v, max) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}
