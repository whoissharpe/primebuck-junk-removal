// GET /admin — password-gated dashboard listing every quote form submission,
// with lightweight CRM features: mark leads contacted, track how many times
// and when, and filter between "needs contact" and "contacted".
//
// Requires two extra D1 columns beyond the base schema (run once in the
// Cloudflare D1 SQL console):
//   ALTER TABLE leads ADD COLUMN contacted_count INTEGER DEFAULT 0;
//   ALTER TABLE leads ADD COLUMN last_contacted_at TEXT;
// The page degrades gracefully (contact tracking just won't show) if these
// haven't been added yet.
//
// Uses HTTP Basic Auth (browser's native login prompt) checked against the
// ADMIN_PASSWORD secret set in Pages > Settings > Variables and secrets.

import { requireAuth } from "../_lib/auth.js";

export async function onRequestGet(context) {
  const { request, env } = context;

  const unauthorized = requireAuth(request, env);
  if (unauthorized) return unauthorized;

  let columns;
  try {
    const info = await env.DB.prepare("PRAGMA table_info(leads)").all();
    columns = new Set((info.results || []).map((c) => c.name));
  } catch (err) {
    return new Response("Database error (couldn't read schema): " + err.message, { status: 500 });
  }

  const hasPhotos = columns.has("photos");
  const hasContactedCount = columns.has("contacted_count");
  const hasLastContactedAt = columns.has("last_contacted_at");
  const hasContactTracking = hasContactedCount && hasLastContactedAt;

  const missing = [];
  if (!hasContactedCount) missing.push("contacted_count INTEGER DEFAULT 0");
  if (!hasLastContactedAt) missing.push("last_contacted_at TEXT");

  const selectCols = ["id", "name", "phone", "email", "message", "sms_consent", "created_at"];
  if (hasPhotos) selectCols.push("photos");
  if (hasContactTracking) selectCols.push("contacted_count", "last_contacted_at");

  let rows = [];
  try {
    const result = await env.DB.prepare(
      `SELECT ${selectCols.join(", ")} FROM leads ORDER BY created_at DESC`
    ).all();
    rows = result.results || [];
  } catch (err) {
    return new Response("Database error: " + err.message, { status: 500 });
  }

  return new Response(renderPage(rows, hasContactTracking, missing), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
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
  return String(raw ?? "").replace(/[^\d+]/g, "");
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

function renderContactCell(r) {
  const count = r.contacted_count || 0;
  const contacted = count > 0;
  const lastText = contacted && r.last_contacted_at ? `Last: ${esc(fmtDate(r.last_contacted_at))}` : "";
  return `
    <div class="contact-cell" data-row-id="${r.id}">
      <button type="button" class="cbtn cbtn--minus" data-action="dec" aria-label="Decrease contact count" ${contacted ? "" : "disabled"}>−</button>
      <span class="contact-count ${contacted ? "is-contacted" : ""}">${contacted ? count + "×" : "Not contacted"}</span>
      <button type="button" class="cbtn cbtn--plus" data-action="inc" aria-label="Mark as contacted">+</button>
    </div>
    ${lastText ? `<div class="contact-last">${lastText}</div>` : ""}
  `;
}

function renderPage(rows, hasContactTracking, missing) {
  const count = rows.length;
  const thisWeek = rows.filter(r => isThisWeek(r.created_at)).length;
  const smsOptIns = rows.filter(r => r.sms_consent).length;
  const withPhotos = rows.filter(r => parsedPhotos(r.photos).length).length;
  const needsContact = hasContactTracking ? rows.filter(r => !(r.contacted_count > 0)).length : null;

  const contactTh = hasContactTracking ? `<th>Contact</th>` : "";
  const migrationNotice = hasContactTracking ? "" : `
    <div class="notice">
      Contact tracking isn't fully set up — missing column${missing.length > 1 ? "s" : ""}: <strong>${esc(missing.map(m => m.split(" ")[0]).join(", "))}</strong>.
      Run these <em>one at a time</em> (separately, not pasted together) in the Cloudflare D1 SQL console:
      ${missing.map(m => `<code>ALTER TABLE leads ADD COLUMN ${esc(m)};</code>`).join("")}
      Then refresh this page. If a column already exists you'll get a harmless "duplicate column name" error on that one — that's fine, it means it's already there.
    </div>`;

  const body = rows.length
    ? rows.map(r => {
        const photos = parsedPhotos(r.photos);
        const contacted = hasContactTracking && r.contacted_count > 0;
        return `
        <tr class="${isNew(r.created_at) ? "is-new" : ""}" ${hasContactTracking ? `data-contacted="${contacted ? 1 : 0}"` : ""}>
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
          ${hasContactTracking ? `<td data-label="Contact">${renderContactCell(r)}</td>` : ""}
        </tr>`;
      }).join("")
    : `<tr><td colspan="${hasContactTracking ? 8 : 7}" class="empty">
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
    margin:0;color:var(--bone);font-family:var(--body);overflow-x:hidden;
    background:
      radial-gradient(60rem 30rem at 12% -10%, rgba(181,70,47,.10), transparent 60%),
      radial-gradient(50rem 26rem at 100% 0%, rgba(49,70,30,.35), transparent 55%),
      var(--ground);
    padding:2.5rem 1.5rem 5rem;line-height:1.5;
  }
  h1,h2{font-family:var(--display);margin:0;letter-spacing:-.02em}
  .wrap{max-width:88rem;margin:0 auto;position:relative;z-index:1}

  .topbar{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:2rem;flex-wrap:wrap}
  .brand{display:flex;align-items:center;gap:.85rem}
  .brand__mark{width:2.75rem;height:2.75rem;object-fit:contain;flex:none;display:block}
  .brand__text{line-height:1.25}
  .brand__text .biz{font-family:var(--display);font-weight:800;font-size:1.02rem}
  .brand__text .tag{color:var(--muted);font-size:.78rem;letter-spacing:.06em;text-transform:uppercase}

  /* ---------- background watermark ---------- */
  .bg-buck{
    position:fixed;top:50%;right:-4rem;transform:translateY(-50%);
    width:min(42vw,32rem);height:auto;opacity:.05;z-index:0;
    pointer-events:none;user-select:none;
  }
  @media(max-width:900px){.bg-buck{display:none}}

  h1{font-size:1.9rem}
  .sub{color:var(--muted);font-size:.92rem;margin:.35rem 0 0}

  .notice{
    margin:1.25rem 0;padding:.9rem 1.1rem;border-radius:8px;font-size:.85rem;
    background:rgba(198,117,97,.1);border:1px solid rgba(198,117,97,.3);color:var(--bone);
  }
  .notice code{display:block;margin-top:.5rem;font-size:.78rem;color:var(--clay-step);
    white-space:pre-wrap;word-break:break-word;font-family:monospace}

  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line-soft);
    border-radius:10px;overflow:hidden;margin:1.5rem 0 1.75rem;border:1px solid var(--line-soft)}
  .stat{background:var(--raised);padding:1.15rem 1.3rem}
  .stat__n{font-family:var(--display);font-size:1.7rem;font-weight:800;letter-spacing:-.02em}
  .stat__label{color:var(--muted);font-size:.76rem;letter-spacing:.06em;text-transform:uppercase;margin-top:.2rem}
  .stat--flag .stat__n{color:var(--clay-step)}
  @media(min-width:640px){.stats{grid-template-columns:repeat(5,1fr)}}
  @media(max-width:639px){.stats{grid-template-columns:repeat(2,1fr)}}

  .filterbar{display:flex;gap:.5rem;margin-bottom:1.25rem;flex-wrap:wrap}
  .filter-btn{
    font-family:var(--body);font-size:.82rem;font-weight:600;color:var(--muted);
    background:var(--raised);border:1px solid var(--line-soft);border-radius:999px;
    padding:.5rem 1.05rem;cursor:pointer;transition:all .12s ease;
  }
  .filter-btn:hover{color:var(--bone);border-color:var(--line)}
  .filter-btn.is-active{background:var(--clay);border-color:var(--clay);color:var(--bone)}

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
  .msg{max-width:22rem}
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

  /* ---------- contact tracker ---------- */
  .contact-cell{display:inline-flex;align-items:center;gap:.5rem}
  .cbtn{
    width:1.7rem;height:1.7rem;border-radius:50%;border:1px solid var(--line);
    background:var(--raised2);color:var(--bone);font-size:1rem;line-height:1;
    cursor:pointer;display:inline-flex;align-items:center;justify-content:center;
    transition:background-color .12s ease,border-color .12s ease,opacity .12s ease;
  }
  .cbtn:hover:not(:disabled){background:var(--clay);border-color:var(--clay)}
  .cbtn:disabled{opacity:.35;cursor:not-allowed}
  .contact-count{font-size:.85rem;font-weight:600;color:var(--muted);white-space:nowrap;min-width:5.2rem;text-align:center}
  .contact-count.is-contacted{color:var(--good)}
  .contact-last{color:var(--muted);font-size:.74rem;margin-top:.35rem}

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
  <img class="bg-buck" src="/assets/logo.png" alt="" aria-hidden="true">
  <div class="wrap">
    <div class="topbar">
      <div class="brand">
        <img class="brand__mark" src="/assets/logo.png" alt="Prime Buck Junk Removal" width="44" height="44">
        <div class="brand__text">
          <div class="biz">Prime Buck Junk Removal</div>
          <div class="tag">Admin dashboard</div>
        </div>
      </div>
    </div>

    <h1>Quote requests</h1>
    <p class="sub">Newest first — refresh to see new submissions.</p>

    ${migrationNotice}

    <div class="stats">
      <div class="stat"><div class="stat__n">${count}</div><div class="stat__label">Total leads</div></div>
      <div class="stat"><div class="stat__n">${thisWeek}</div><div class="stat__label">Past 7 days</div></div>
      <div class="stat"><div class="stat__n">${smsOptIns}</div><div class="stat__label">SMS opt-ins</div></div>
      <div class="stat"><div class="stat__n">${withPhotos}</div><div class="stat__label">With photos</div></div>
      ${hasContactTracking ? `<div class="stat stat--flag"><div class="stat__n">${needsContact}</div><div class="stat__label">Needs contact</div></div>` : ""}
    </div>

    ${hasContactTracking ? `
    <div class="filterbar">
      <button type="button" class="filter-btn is-active" data-filter="all">All</button>
      <button type="button" class="filter-btn" data-filter="pending">Needs contact</button>
      <button type="button" class="filter-btn" data-filter="done">Contacted</button>
    </div>` : ""}

    <div class="card">
      <table>
        <thead>
          <tr><th>Received</th><th>Name</th><th>Phone</th><th>Email</th><th>Message</th><th>SMS OK</th><th>Photos</th>${contactTh}</tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </div>

  ${hasContactTracking ? `<script>
  (function () {
    'use strict';
    var filterBtns = document.querySelectorAll('.filter-btn');
    var rows = document.querySelectorAll('tbody tr[data-contacted]');

    function applyFilter(f) {
      rows.forEach(function (tr) {
        var contacted = tr.getAttribute('data-contacted') === '1';
        var show = f === 'all' || (f === 'pending' && !contacted) || (f === 'done' && contacted);
        tr.style.display = show ? '' : 'none';
      });
    }

    filterBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        filterBtns.forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        applyFilter(btn.getAttribute('data-filter'));
      });
    });

    document.querySelectorAll('.cbtn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cell = btn.closest('.contact-cell');
        var id = Number(cell.getAttribute('data-row-id'));
        var delta = btn.getAttribute('data-action') === 'inc' ? 1 : -1;
        var minus = cell.querySelector('.cbtn--minus');
        var plus = cell.querySelector('.cbtn--plus');
        var wasContacted = cell.querySelector('.contact-count').classList.contains('is-contacted');
        minus.disabled = true;
        plus.disabled = true;

        fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, delta: delta }),
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data.ok) throw new Error(data.error || 'failed');
            var countEl = cell.querySelector('.contact-count');
            var newCount = data.contacted_count || 0;
            countEl.textContent = newCount > 0 ? newCount + '×' : 'Not contacted';
            countEl.classList.toggle('is-contacted', newCount > 0);
            minus.disabled = newCount <= 0;

            var row = cell.closest('tr');
            row.setAttribute('data-contacted', newCount > 0 ? '1' : '0');

            var lastEl = row.querySelector('.contact-last');
            if (newCount > 0 && data.last_contacted_at) {
              var text = 'Last: ' + new Date(data.last_contacted_at.replace(' ', 'T') + 'Z').toLocaleString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
              });
              if (lastEl) { lastEl.textContent = text; }
              else {
                lastEl = document.createElement('div');
                lastEl.className = 'contact-last';
                lastEl.textContent = text;
                cell.parentElement.appendChild(lastEl);
              }
            } else if (lastEl) {
              lastEl.remove();
            }

            var activeFilter = document.querySelector('.filter-btn.is-active');
            if (activeFilter) applyFilter(activeFilter.getAttribute('data-filter'));

            var nowContacted = newCount > 0;
            if (nowContacted !== wasContacted) {
              var flagEl = document.querySelector('.stat--flag .stat__n');
              if (flagEl) {
                var n = parseInt(flagEl.textContent, 10) || 0;
                flagEl.textContent = String(nowContacted ? Math.max(0, n - 1) : n + 1);
              }
            }
          })
          .catch(function () {
            alert('Could not update — please try again.');
          })
          .finally(function () {
            plus.disabled = false;
            var stillContacted = cell.querySelector('.contact-count').classList.contains('is-contacted');
            minus.disabled = !stillContacted;
          });
      });
    });
  })();
  </script>` : ""}
</body>
</html>`;
}
