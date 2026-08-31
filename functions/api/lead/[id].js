// PUT /api/lead/:id — admin-only edit of an existing lead.
// DELETE /api/lead/:id — admin-only permanent delete of a lead.
// Both protected by the same Basic Auth as /admin.
//
// Source lock: if the lead's current source is "Website", it stays
// "Website" no matter what the request sends — that value is reserved for
// leads that actually came through the public quote form and can't be
// reassigned via this endpoint. Manually-sourced leads can be edited among
// the manual source options (still never "Website").

import { requireAuth } from "../../_lib/auth.js";

const MANUAL_SOURCES = ["Phone call", "Text", "Referral", "Facebook", "Instagram", "Google", "Walk-in", "Other"];

export async function onRequestPut(context) {
  const { request, env, params } = context;

  const unauthorized = requireAuth(request, env);
  if (unauthorized) return unauthorized;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return json({ ok: false, error: "invalid_id" }, 400);
  }

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
  const requestedSource = clean(data.source, 40);

  if (!name || !phone || !message) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "invalid_email" }, 400);
  }

  // Look up the current source so we can enforce the Website lock.
  let currentSource = null;
  try {
    const existing = await env.DB.prepare("SELECT source FROM leads WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: "not_found" }, 404);
    currentSource = existing.source;
  } catch {
    // `source` column may not exist yet — fall through, handled below.
  }

  let finalSource = currentSource;
  if (currentSource !== "Website") {
    if (!MANUAL_SOURCES.includes(requestedSource)) {
      return json({ ok: false, error: "invalid_source" }, 400);
    }
    finalSource = requestedSource;
  }
  // If currentSource === "Website", finalSource stays "Website" — locked, ignore the request value.

  try {
    // Full update, including notes and source.
    await env.DB.prepare(
      "UPDATE leads SET name = ?, phone = ?, email = ?, message = ?, sms_consent = ?, source = ?, notes = ? WHERE id = ?"
    ).bind(name, phone, email || "", message, smsConsent, finalSource, notes || null, id).run();
  } catch (err) {
    try {
      // Fallback for schemas without the `notes` column yet.
      await env.DB.prepare(
        "UPDATE leads SET name = ?, phone = ?, email = ?, message = ?, sms_consent = ?, source = ? WHERE id = ?"
      ).bind(name, phone, email || "", message, smsConsent, finalSource, id).run();
    } catch (err2) {
      try {
        // Fallback for schemas without `source` (or `notes`) yet.
        await env.DB.prepare(
          "UPDATE leads SET name = ?, phone = ?, email = ?, message = ?, sms_consent = ? WHERE id = ?"
        ).bind(name, phone, email || "", message, smsConsent, id).run();
      } catch (err3) {
        return json({ ok: false, error: "db_error", message: String((err3 && err3.message) || err3) }, 500);
      }
    }
  }

  return json({ ok: true, id, source: finalSource });
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;

  const unauthorized = requireAuth(request, env);
  if (unauthorized) return unauthorized;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return json({ ok: false, error: "invalid_id" }, 400);
  }

  try {
    const result = await env.DB.prepare("DELETE FROM leads WHERE id = ?").bind(id).run();
    const deleted = result && result.meta && result.meta.changes > 0;
    if (!deleted) return json({ ok: false, error: "not_found" }, 404);
    return json({ ok: true, id });
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
