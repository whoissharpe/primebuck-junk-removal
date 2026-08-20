// GET /admin — password-gated dashboard listing every quote form submission.
// Uses HTTP Basic Auth (browser's native login prompt) checked against the
// ADMIN_PASSWORD secret set in Pages > Settings > Variables and secrets.
// Username can be anything; only the password is checked.

export async function onRequestGet(context) {
  const { request, env } = context;

  const auth = request.headers.get("Authorization");
  if (!isAuthorized(auth, env.ADMIN_PASSWORD)) {
    return new Response("Authentication required.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Prime Buck Admin"' },
    });
  }

  let rows = [];
  try {
    const result = await env.DB.prepare(
      "SELECT id, name, phone, email, message, sms_consent, created_at FROM leads ORDER BY created_at DESC"
    ).all();
    rows = result.results || [];
  } catch (err) {
    return new Response("Database error: " + err.message, { status: 500 });
  }

  return new Response(renderPage(rows), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isAuthorized(header, expected) {
  if (!header || !expected) return false;
  if (!header.startsWith("Basic ")) return false;
  let decoded;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return false;
  }
  const idx = decoded.indexOf(":");
  const pass = idx === -1 ? decoded : decoded.slice(idx + 1);
  return pass === expected;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function renderPage(rows) {
  const count = rows.length;
  const body = rows.length
    ? rows.map(r => `
        <tr>
          <td class="nowrap">${esc(fmtDate(r.created_at))}</td>
          <td>${esc(r.name)}</td>
          <td><a href="tel:${esc(r.phone.replace(/[^\d+]/g,''))}">${esc(r.phone)}</a></td>
          <td><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></td>
          <td class="msg">${esc(r.message)}</td>
          <td class="nowrap">${r.sms_consent ? "Yes" : "No"}</td>
        </tr>`).join("")
    : `<tr><td colspan="6" class="empty">No submissions yet. New quote requests will appear here automatically.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Admin — Prime Buck Junk Removal</title>
<style>
  :root{
    --ground:#131A0E; --raised:#1B2614; --bone:#F2EEE3;
    --muted:#A8B39C; --clay:#B5462F; --line:rgba(242,238,227,.14);
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--ground);color:var(--bone);
    font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;padding:2rem 1.5rem 4rem}
  .wrap{max-width:72rem;margin:0 auto}
  h1{font-size:1.5rem;margin:0 0 .25rem}
  .sub{color:var(--muted);font-size:.9rem;margin:0 0 2rem}
  table{width:100%;border-collapse:collapse;background:var(--raised);border-radius:4px;overflow:hidden}
  th{text-align:left;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;
     color:var(--muted);padding:.85rem 1rem;border-bottom:1px solid var(--line)}
  td{padding:.85rem 1rem;border-bottom:1px solid var(--line);font-size:.9rem;vertical-align:top}
  tr:last-child td{border-bottom:0}
  a{color:var(--bone)}
  .nowrap{white-space:nowrap}
  .msg{max-width:26rem;white-space:pre-wrap}
  .empty{text-align:center;color:var(--muted);padding:3rem 1rem}
  .count{display:inline-block;background:var(--clay);color:var(--bone);
    border-radius:2px;padding:.15rem .55rem;font-size:.78rem;margin-left:.5rem}
</style>
</head>
<body>
  <div class="wrap">
    <h1>Quote requests<span class="count">${count}</span></h1>
    <p class="sub">Prime Buck Junk Removal — newest first</p>
    <table>
      <thead>
        <tr><th>Received</th><th>Name</th><th>Phone</th><th>Email</th><th>Message</th><th>SMS OK</th></tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  </div>
</body>
</html>`;
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T") + "Z");
  if (isNaN(d)) return iso;
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}
