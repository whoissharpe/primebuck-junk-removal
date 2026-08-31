// POST /api/submit — receives the quote form, stores it in D1, and
// emails the owner a notification so new leads don't sit unseen.
// Bound database variable name is "DB" (see Pages Settings > Bindings).
//
// Required Cloudflare Pages secrets/vars for email notifications:
//   RESEND_API_KEY  — API key from resend.com (free tier: 3,000 emails/mo)
//   NOTIFY_EMAIL    — where new-lead alerts should be sent (e.g. owner's inbox)
// Optional:
//   NOTIFY_FROM     — verified sender, e.g. "Prime Buck Leads <leads@primebuckjunkremoval.com>"
//                      Defaults to Resend's shared sandbox sender if unset/unverified.
// If RESEND_API_KEY or NOTIFY_EMAIL aren't set, the lead still saves to D1 —
// notification is best-effort and never blocks or fails the submission.

const MAX_PHOTOS = 3;
const MAX_PHOTO_CHARS = 900000; // ~650KB decoded, per photo — keeps D1 rows small

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const name = clean(data.name, 120);
  const phone = clean(data.phone, 40);
  const email = clean(data.email, 200); // optional
  const message = clean(data.message, 2000);
  const smsConsent = data.smsConsent ? 1 : 0;
  const photos = cleanPhotos(data.photos);

  if (!name || !phone || !message) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "invalid_email" }, 400);
  }

  let leadId;
  try {
    const result = await env.DB.prepare(
      "INSERT INTO leads (name, phone, email, message, sms_consent, photos, source) VALUES (?, ?, ?, ?, ?, ?, 'Website')"
    )
      .bind(name, phone, email || "", message, smsConsent, photos.length ? JSON.stringify(photos) : null)
      .run();
    leadId = result && result.meta && result.meta.last_row_id;
  } catch (err) {
    // Fallback for sites that haven't run the `source` column migration yet.
    try {
      const result = await env.DB.prepare(
        "INSERT INTO leads (name, phone, email, message, sms_consent, photos) VALUES (?, ?, ?, ?, ?, ?)"
      )
        .bind(name, phone, email || "", message, smsConsent, photos.length ? JSON.stringify(photos) : null)
        .run();
      leadId = result && result.meta && result.meta.last_row_id;
    } catch (err2) {
      // Fallback for sites that also haven't run the `photos` column migration yet —
      // retry without it so submissions never silently fail.
      try {
        const result = await env.DB.prepare(
          "INSERT INTO leads (name, phone, email, message, sms_consent) VALUES (?, ?, ?, ?, ?)"
        )
          .bind(name, phone, email || "", message, smsConsent)
          .run();
        leadId = result && result.meta && result.meta.last_row_id;
      } catch (err3) {
        return json({ ok: false, error: "db_error" }, 500);
      }
    }
  }

  // Fire the notification without making the visitor wait on it.
  waitUntil(
    notifyOwner(env, { id: leadId, name, phone, email, message, smsConsent, photoCount: photos.length }).catch(
      function () {} // notification failure must never surface to the visitor
    )
  );

  return json({ ok: true });
}

function clean(v, max) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function cleanPhotos(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter(function (p) {
      return typeof p === "string" && p.indexOf("data:image/") === 0 && p.length <= MAX_PHOTO_CHARS;
    })
    .slice(0, MAX_PHOTOS);
}

async function notifyOwner(env, lead) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) return; // not configured — skip quietly

  const from = env.NOTIFY_FROM || "Prime Buck Leads <onboarding@resend.dev>";
  const subject = "New quote request — " + lead.name;
  const lines = [
    "Name: " + lead.name,
    "Phone: " + lead.phone,
    lead.email ? "Email: " + lead.email : "Email: (not provided)",
    "SMS opt-in: " + (lead.smsConsent ? "Yes" : "No"),
    lead.photoCount ? "Photos attached: " + lead.photoCount : null,
    "",
    "Message:",
    lead.message,
    "",
    "View all leads: https://primebuck-junk-removal.pages.dev/admin",
  ].filter(function (l) { return l !== null; });

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: from,
      to: env.NOTIFY_EMAIL,
      subject: subject,
      text: lines.join("\n"),
    }),
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}
