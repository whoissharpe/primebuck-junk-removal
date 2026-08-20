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
      "SELECT id, name, phone, email, message, sms_consent, created_at, photos FROM leads ORDER BY created_at DESC"
    ).all();
    rows = result.results || [];
  } catch (err) {
    // Older schema without the `photos` column yet — fall back gracefully.
    try {
      const result = await env.DB.prepare(
        "SELECT id, name, phone, email, message, sms_consent, created_at FROM leads ORDER BY created_at DESC"
      ).all();
      rows = result.results || [];
    } catch (err2) {
      return new Response("Database error: " + err2.message, { status: 500 });
    }
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

function parsedPhotos(raw) {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function renderPhotos(raw) {
  const list = parsedPhotos(raw);
  if (!list.length) return `<span class="empty-cell">—</span>`;
  return `<div class="thumbs">` + list.map(src =>
    `<a href="${esc(src)}" target="_blank" rel="noopener"><img class="thumb" src="${esc(src)}" alt="Photo attached to request" loading="lazy"></a>`
  ).join("") + `</div>`;
}

function fmtPhone(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === "1") {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw ?? "";
}

function telHref(raw) {
  const digits = String(raw ?? "").replace(/[^\d+]/g, "");
  return digits;
}

function isNew(iso) {
  if (!iso) return false;
  const d = new Date(iso.replace(" ", "T") + "Z");
  if (isNaN(d)) return false;
  return Date.now() - d.getTime() < 24 * 60 * 60 * 1000;
}

function isThisWeek(iso) {
  if (!iso) return false;
  const d = new Date(iso.replace(" ", "T") + "Z");
  if (isNaN(d)) return false;
  return Date.now() - d.getTime() < 7 * 24 * 60 * 60 * 1000;
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

function truncate(s, max) {
  const str = String(s ?? "");
  if (str.length <= max) return { short: str, full: null };
  return { short: str.slice(0, max).trimEnd() + "…", full: str };
}

function renderMessage(msg) {
  const { short, full } = truncate(msg, 90);
  if (!full) return `<span>${esc(short)}</span>`;
  return `<details class="msg-more"><summary>${esc(short)}</summary><p>${esc(full)}</p></details>`;
}

function renderPage(rows) {
  const count = rows.length;
  const thisWeek = rows.filter(r => isThisWeek(r.created_at)).length;
  const smsOptIns = rows.filter(r => r.sms_consent).length;
  const withPhotos = rows.filter(r => parsedPhotos(r.photos).length).length;

  const body = rows.length
    ? rows.map(r => {
        const photos = parsedPhotos(r.photos);
        return `
        <tr class="${isNew(r.created_at) ? "is-new" : ""}">
          <td class="nowrap" data-label="Received">
            ${isNew(r.created_at) ? `<span class="badge badge--new">New</span>` : ""}
            ${esc(fmtDate(r.created_at))}
          </td>
          <td data-label="Name"><span class="name">${esc(r.name)}</span></td>
          <td class="nowrap" data-label="Phone"><a class="pill-link" href="tel:${esc(telHref(r.phone))}">${esc(fmtPhone(r.phone))}</a></td>
          <td data-label="Email">${r.email ? `<a class="pill-link" href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : `<span class="empty-cell">—</span>`}</td>
          <td class="msg" data-label="Message">${renderMessage(r.message)}</td>
          <td class="nowrap" data-label="SMS OK">${r.sms_consent ? `<span class="badge badge--yes">Yes</span>` : `<span class="badge badge--no">No</span>`}</td>
          <td data-label="Photos">${photos.length ? renderPhotos(r.photos) : `<span class="empty-cell">—</span>`}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="7" class="empty">
         <svg viewBox="0 0 24 24" aria-hidden="true" class="empty-ico"><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/><path d="M7 9l5-5 5 5"/><path d="M12 4v13"/></svg>
         <p>No submissions yet.</p>
         <p class="muted">New quote requests will appear here automatically.</p>
       </td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Admin — Prime Buck Junk Removal</title>
<link rel="preconnect" href="https://api.fontshare.com">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://api.fontshare.com/v2/css?f%5B%5D=cabinet-grotesk@800,700&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&display=swap">
<style>
  :root{
    --ground:#131A0E; --raised:#1B2614; --raised2:#202D18; --bone:#F2EEE3;
    --muted:#A8B39C; --clay:#B5462F; --clay-lift:#C8502F; --clay-step:#C67561;
    --line:rgba(242,238,227,.14); --line-soft:rgba(242,238,227,.07);
    --display:"Cabinet Grotesk","Inter Tight",system-ui,sans-serif;
    --body:"Inter Tight",system-ui,-apple-system,sans-serif;
    --good:#5FAE72; --good-bg:rgba(95,174,114,.14);
  }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{
    margin:0;color:var(--bone);font-family:var(--body);
    background:
      radial-gradient(60rem 30rem at 12% -10%, rgba(181,70,47,.10), transparent 60%),
      radial-gradient(50rem 26rem at 100% 0%, rgba(49,70,30,.35), transparent 55%),
      var(--ground);
    padding:2.5rem 1.5rem 5rem;line-height:1.5;
  }
  h1,h2{font-family:var(--display);margin:0;letter-spacing:-.02em}
  .wrap{max-width:80rem;margin:0 auto}

  .topbar{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:2rem;flex-wrap:wrap}
  .brand{display:flex;align-items:center;gap:.7rem}
  .brand__mark{
    width:2.5rem;height:2.5rem;border-radius:6px;background:var(--clay);
    display:flex;align-items:center;justify-content:center;flex:none;
    font-family:var(--display);font-weight:800;font-size:1.05rem;color:var(--bone);
  }
  .brand__text{line-height:1.25}
  .brand__text .biz{font-family:var(--display);font-weight:800;font-size:1.02rem}
  .brand__text .tag{color:var(--muted);font-size:.78rem;letter-spacing:.06em;text-transform:uppercase}

  h1{font-size:1.9rem}
  .sub{color:var(--muted);font-size:.92rem;margin:.35rem 0 0}

  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line-soft);
    border-radius:10px;overflow:hidden;margin-bottom:2rem;border:1px solid var(--line-soft)}
  .stat{background:var(--raised);padding:1.15rem 1.3rem}
  .stat__n{font-family:var(--display);font-size:1.7rem;font-weight:800;letter-spacing:-.02em}
  .stat__label{color:var(--muted);font-size:.76rem;letter-spacing:.06em;text-transform:uppercase;margin-top:.2rem}
  @media(max-width:760px){.stats{grid-template-columns:repeat(2,1fr)}}

  .card{
    background:var(--raised);border:1px solid var(--line-soft);border-radius:10px;overflow:hidden;
    box-shadow:0 18px 40px rgba(0,0,0,.25);
  }
  table{width:100%;border-collapse:collapse}
  th{
    text-align:left;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;
    color:var(--muted);padding:.95rem 1.15rem;border-bottom:1px solid var(--line);
    background:var(--raised2);position:sticky;top:0;
  }
  td{padding:1rem 1.15rem;border-bottom:1px solid var(--line-soft);font-size:.92rem;vertical-align:top}
  tbody tr{transition:background-color .12s ease}
  tbody tr:hover{background:rgba(242,238,227,.028)}
  tbody tr.is-new{background:rgba(181,70,47,.06)}
  tr:last-child td{border-bottom:0}

  a{color:var(--bone)}
  .name{font-weight:600}
  .pill-link{
    color:var(--bone);text-decoration:none;border-bottom:1px solid var(--line);
    padding-bottom:1px;transition:border-color .12s ease;
  }
  .pill-link:hover{border-color:var(--clay-step)}
  .nowrap{white-space:nowrap}
  .msg{max-width:24rem}
  .msg-more summary{cursor:pointer;list-style:none}
  .msg-more summary::-webkit-details-marker{display:none}
  .msg-more summary::after{content:" ▾";color:var(--muted);font-size:.75rem}
  .msg-more[open] summary::after{content:" ▴"}
  .msg-more p{margin:.5rem 0 0;color:var(--muted);white-space:pre-wrap}
  .muted{color:var(--muted)}
  .empty-cell{color:var(--muted)}

  .badge{
    display:inline-flex;align-items:center;border-radius:999px;padding:.22rem .65rem;
    font-size:.74rem;font-weight:600;letter-spacing:.02em;white-space:nowrap;
  }
  .badge--new{background:var(--clay);color:var(--bone);margin-right:.5rem}
  .badge--yes{background:var(--good-bg);color:var(--good)}
  .badge--no{background:rgba(242,238,227,.08);color:var(--muted)}

  .thumbs{display:flex;gap:.4rem;flex-wrap:wrap}
  .thumb{
    width:52px;height:52px;object-fit:cover;border-radius:6px;border:1px solid var(--line);
    display:block;transition:transform .15s ease;
  }
  .thumb:hover{transform:scale(1.08)}

  .empty{text-align:center;color:var(--muted);padding:4.5rem 1.5rem}
  .empty-ico{width:34px;height:34px;stroke:var(--muted);fill:none;stroke-width:1.6;
    stroke-linecap:round;stroke-linejoin:round;margin-bottom:.75rem}
  .empty p{margin:.25rem 0}
  .empty p:first-of-type{color:var(--bone);font-weight:600;font-size:1.02rem}

  /* ---------- mobile: collapse table into cards ---------- */
  @media(max-width:820px){
    .card{box-shadow:none;border-radius:0;border:none;background:transparent}
    table{display:block}
    thead{display:none}
    tbody{display:flex;flex-direction:column;gap:.9rem}
    tbody tr{
      display:block;background:var(--raised);border:1px solid var(--line-soft);
      border-radius:10px;padding:.25rem 1rem;
    }
    tbody tr.is-new{border-color:rgba(181,70,47,.4)}
    td{
      display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;
      border-bottom:1px solid var(--line-soft);padding:.7rem 0;text-align:right;
    }
    td:last-child{border-bottom:0}
    td::before{
      content:attr(data-label);color:var(--muted);font-size:.72rem;letter-spacing:.06em;
      text-transform:uppercase;text-align:left;flex:none;padding-top:.15rem;
    }
    .msg{max-width:none;text-align:left}
    .msg-more{width:100%}
    .thumbs{justify-content:flex-end}
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div class="brand">
        <div class="brand__mark">PB</div>
        <div class="brand__text">
          <div class="biz">Prime Buck Junk Removal</div>
          <div class="tag">Admin dashboard</div>
        </div>
      </div>
    </div>

    <h1>Quote requests</h1>
    <p class="sub">Newest first — refresh to see new submissions.</p>

    <div class="stats">
      <div class="stat"><div class="stat__n">${count}</div><div class="stat__label">Total leads</div></div>
      <div class="stat"><div class="stat__n">${thisWeek}</div><div class="stat__label">Past 7 days</div></div>
      <div class="stat"><div class="stat__n">${smsOptIns}</div><div class="stat__label">SMS opt-ins</div></div>
      <div class="stat"><div class="stat__n">${withPhotos}</div><div class="stat__label">With photos</div></div>
    </div>

    <div class="card">
      <table>
        <thead>
          <tr><th>Received</th><th>Name</th><th>Phone</th><th>Email</th><th>Message</th><th>SMS OK</th><th>Photos</th></tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}
