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

  if (!name || !phone || !message) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "invalid_email" }, 400);
  }
  if (!ALLOWED_SOURCES.includes(source)) {
    return json({ ok: false, error: "invalid_source" }, 400);
  }

  try {
    let result;
    try {
      result = await env.DB.prepare(
        "INSERT INTO leads (name, phone, email, message, sms_consent, source, notes) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(name, phone, email || "", message, smsConsent, source, notes || null)
        .run();
    } catch (err) {
      // Fallback for schemas without the `notes` column yet.
      result = await env.DB.prepare(
        "INSERT INTO leads (name, phone, email, message, sms_consent, source) VALUES (?, ?, ?, ?, ?, ?)"
      )
        .bind(name, phone, email || "", message, smsConsent, source)
        .run();
    }
    const id = result && result.meta && result.meta.last_row_id;
    return json({ ok: true, id: id });
  } catch (err) {
    return json({ ok: false, error: "db_error", message: String((err && err.message) || err) }, 500);
  }
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
