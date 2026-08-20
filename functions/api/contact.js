// POST /api/contact — increments or decrements a lead's contacted_count.
// Admin-only: protected by the same Basic Auth as /admin, so this can't be
// hit by the public. Called from the admin dashboard's +/- buttons.
//
// Body: { id: number, delta: 1 | -1 }
// Requires the `contacted_count` and `last_contacted_at` columns — see the
// migration note in functions/admin/index.js.

import { requireAuth } from "../_lib/auth.js";

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

  const id = Number(data.id);
  const delta = Number(data.delta);
  if (!Number.isInteger(id) || id <= 0 || (delta !== 1 && delta !== -1)) {
    return json({ ok: false, error: "invalid_params" }, 400);
  }

  try {
    if (delta > 0) {
      await env.DB.prepare(
        "UPDATE leads SET contacted_count = COALESCE(contacted_count, 0) + 1, last_contacted_at = datetime('now') WHERE id = ?"
      ).bind(id).run();
    } else {
      await env.DB.prepare(
        "UPDATE leads SET contacted_count = MAX(0, COALESCE(contacted_count, 0) - 1) WHERE id = ?"
      ).bind(id).run();
    }

    const row = await env.DB.prepare(
      "SELECT contacted_count, last_contacted_at FROM leads WHERE id = ?"
    ).bind(id).first();

    if (!row) return json({ ok: false, error: "not_found" }, 404);

    return json({
      ok: true,
      contacted_count: row.contacted_count || 0,
      last_contacted_at: row.last_contacted_at || null,
    });
  } catch (err) {
    return json({ ok: false, error: "db_error", message: String((err && err.message) || err) }, 500);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}
