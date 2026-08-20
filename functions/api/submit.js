// POST /api/submit — receives the quote form and stores it in D1.
// Bound database variable name is "DB" (see Pages Settings > Bindings).

export async function onRequestPost(context) {
  const { request, env } = context;

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
  const smsConsent = data.smsConsent ? 1 : 0;

  if (!name || !phone || !email || !message) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "invalid_email" }, 400);
  }

  try {
    await env.DB.prepare(
      "INSERT INTO leads (name, phone, email, message, sms_consent) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(name, phone, email, message, smsConsent)
      .run();
  } catch (err) {
    return json({ ok: false, error: "db_error" }, 500);
  }

  return json({ ok: true });
}

function clean(v, max) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
