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
  const hasSource = columns.has("source");

  const missing = [];
  if (!hasContactedCount) missing.push("contacted_count INTEGER DEFAULT 0");
  if (!hasLastContactedAt) missing.push("last_contacted_at TEXT");
  if (!hasSource) missing.push("source TEXT DEFAULT 'Website'");

  const selectCols = ["id", "name", "phone", "email", "message", "sms_consent", "created_at"];
  if (hasPhotos) selectCols.push("photos");
  if (hasContactTracking) selectCols.push("contacted_count", "last_contacted_at");
  if (hasSource) selectCols.push("source");

  let rows = [];
  try {
    const result = await env.DB.prepare(
      `SELECT ${selectCols.join(", ")} FROM leads ORDER BY created_at DESC`
    ).all();
    rows = result.results || [];
  } catch (err) {
    return new Response("Database error: " + err.message, { status: 500 });
  }

  return new Response(renderPage(rows, hasContactTracking, hasSource, missing), {
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

const MANUAL_SOURCES = ["Phone call", "Text", "Referral", "Facebook", "Instagram", "Google", "Walk-in", "Other"];

function renderSourceBadge(source) {
  if (!source) return `<span class="empty-cell">—</span>`;
  const isWebsite = source === "Website";
  return `<span class="badge ${isWebsite ? "badge--source-web" : "badge--source-manual"}">${esc(source)}</span>`;
}

function renderAddLeadPanel() {
  const options = MANUAL_SOURCES.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
  return `
  <div class="add-lead-panel" id="addLeadPanel" hidden>
    <h2 id="leadPanelTitle">Add a lead manually</h2>
    <p class="sub" id="leadPanelSub">For leads that came in by phone, text, referral, etc. — not through the website form.</p>
    <form id="addLeadForm" class="add-lead-form" novalidate>
      <input type="hidden" id="al-id" name="id" value="">
      <div class="field">
        <label for="al-name">Name</label>
        <input id="al-name" name="name" type="text" required maxlength="120">
      </div>
      <div class="field">
        <label for="al-phone">Phone</label>
        <input id="al-phone" name="phone" type="tel" required maxlength="40">
      </div>
      <div class="field">
        <label for="al-email">Email <span class="muted">(optional)</span></label>
        <input id="al-email" name="email" type="email" maxlength="200">
      </div>
      <div class="field">
        <label for="al-source">Source</label>
        <select id="al-source" name="source" required>
          <option value="" disabled selected>Choose one…</option>
          <option value="Website" disabled>Website (locked — set automatically)</option>
          ${options}
        </select>
      </div>
      <div class="field field--full">
        <label for="al-message">What needs to go?</label>
        <textarea id="al-message" name="message" required maxlength="2000"></textarea>
      </div>
      <div class="field--full">
        <label class="consent" for="al-sms">
          <input id="al-sms" name="sms_consent" type="checkbox" value="yes">
          <span>Customer agreed to receive text messages.</span>
        </label>
      </div>
      <div class="field--full add-lead-actions">
        <button type="submit" class="btn-primary" id="leadPanelSubmit">Save lead</button>
        <button type="button" class="btn-secondary" id="addLeadCancel">Cancel</button>
        <p class="form-status" id="addLeadStatus" role="status" aria-live="polite"></p>
      </div>
    </form>
  </div>`;
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

function renderPage(rows, hasContactTracking, hasSource, missing) {
  const count = rows.length;
  const thisWeek = rows.filter(r => isThisWeek(r.created_at)).length;
  const smsOptIns = rows.filter(r => r.sms_consent).length;
  const withPhotos = rows.filter(r => parsedPhotos(r.photos).length).length;
  const needsContact = hasContactTracking ? rows.filter(r => !(r.contacted_count > 0)).length : null;

  const contactTh = hasContactTracking ? `<th>Contact</th>` : "";
  const sourceTh = hasSource ? `<th>Source</th>` : "";
  const featureNotice = missing.length === 0 ? "" : `
    <div class="notice">
      A couple of features aren't fully set up — missing column${missing.length > 1 ? "s" : ""}: <strong>${esc(missing.map(m => m.split(" ")[0]).join(", "))}</strong>.
      Run these <em>one at a time</em> (separately, not pasted together) in the Cloudflare D1 SQL console:
      ${missing.map(m => `<code>ALTER TABLE leads ADD COLUMN ${esc(m)};</code>`).join("")}
      Then refresh this page. If a column already exists you'll get a harmless "duplicate column name" error on that one — that's fine, it means it's already there.
    </div>`;

  const body = rows.length
    ? rows.map(r => {
        const photos = parsedPhotos(r.photos);
        const contacted = hasContactTracking && r.contacted_count > 0;
        const source = hasSource ? (r.source || "Website") : null;
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
          ${hasSource ? `<td class="nowrap" data-label="Source">${renderSourceBadge(source)}</td>` : ""}
          <td class="nowrap" data-label="Actions">
            <div class="row-actions">
              ${hasSource ? `<button type="button" class="row-btn row-btn--edit" data-id="${r.id}" data-name="${esc(r.name)}" data-phone="${esc(r.phone)}" data-email="${esc(r.email || "")}" data-message="${esc(r.message)}" data-source="${esc(source || "")}" data-sms="${r.sms_consent ? 1 : 0}">Edit</button>` : ""}
              <button type="button" class="row-btn row-btn--delete" data-id="${r.id}" data-name="${esc(r.name)}">Delete</button>
            </div>
          </td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="${7 + (hasContactTracking ? 1 : 0) + (hasSource ? 1 : 0)}" class="empty">
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
<link rel="icon" href="/assets/favicon-32.png" sizes="32x32">
<link rel="icon" href="/assets/favicon.png" sizes="64x64">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<style>
  @font-face{
    font-family:"Inter Tight";
    src:url("/assets/fonts/InterTight-Variable.woff2") format("woff2-variations"),
        url("/assets/fonts/InterTight-Variable.woff2") format("woff2");
    font-weight:100 900;
    font-style:normal;
    font-display:swap;
  }
  :root{
    --ground:#131A0E; --raised:#1B2614; --raised2:#202D18; --bone:#F2EEE3;
    --muted:#A8B39C; --clay:#B5462F; --clay-lift:#C8502F; --clay-step:#C67561;
    --line:rgba(242,238,227,.14); --line-soft:rgba(242,238,227,.07);
    --display:"Inter Tight",system-ui,sans-serif;
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
  h1{font-weight:700;letter-spacing:-.01em}
  h2{font-weight:700}
  h1,h2,.sub,.brand__tag,.stat__n,.stat__label,th,.badge,.filter-btn{
    -webkit-user-select:none;user-select:none;cursor:default;caret-color:transparent;
  }
  .wrap{max-width:88rem;margin:0 auto;position:relative;z-index:1}

  .topbar{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:2rem;flex-wrap:wrap}
  .brand{display:flex;align-items:center;gap:1rem}
  .brand__lockup{height:2.6rem;width:auto;display:block;flex:none}
  .brand__tag{
    color:var(--muted);font-size:.76rem;letter-spacing:.08em;text-transform:uppercase;
    padding-left:1rem;border-left:1px solid var(--line);
  }
  .logout-link{
    color:var(--muted);font-size:.85rem;font-weight:600;text-decoration:none;
    border:1px solid var(--line);border-radius:999px;padding:.5rem 1.1rem;
    transition:all .12s ease;flex:none;
  }
  .logout-link:hover{color:var(--bone);border-color:var(--clay-step)}

  /* ---------- background watermark ---------- */
  .bg-buck{
    position:fixed;top:46%;right:-9rem;transform:translateY(-50%);
    width:min(58vw,44rem);height:auto;opacity:.045;z-index:0;
    pointer-events:none;user-select:none;
  }
  @media(max-width:1100px){.bg-buck{display:none}}

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

  .filterbar{display:flex;gap:.5rem;flex-wrap:wrap}
  .filter-btn{
    font-family:var(--body);font-size:.82rem;font-weight:600;color:var(--muted);
    background:var(--raised);border:1px solid var(--line-soft);border-radius:999px;
    padding:.5rem 1.05rem;cursor:pointer;transition:all .12s ease;
  }
  .filter-btn:hover{color:var(--bone);border-color:var(--line)}
  .filter-btn.is-active{background:var(--clay);border-color:var(--clay);color:var(--bone)}

  .actionbar{display:flex;align-items:center;justify-content:space-between;gap:1rem;
    margin-bottom:1.25rem;flex-wrap:wrap}
  .btn-add-lead{
    font-family:var(--body);font-size:.85rem;font-weight:700;color:var(--bone);
    background:transparent;border:1px solid var(--clay-step);border-radius:999px;
    padding:.55rem 1.15rem;cursor:pointer;transition:all .12s ease;flex:none;
  }
  .btn-add-lead:hover{background:var(--clay);border-color:var(--clay)}

  .add-lead-panel{
    background:var(--raised);border:1px solid var(--line-soft);border-radius:10px;
    padding:1.5rem 1.6rem 1.75rem;margin-bottom:1.5rem;
  }
  .add-lead-panel h2{font-size:1.15rem;margin-bottom:.25rem}
  .add-lead-form{display:grid;gap:1rem;margin-top:1.25rem;grid-template-columns:1fr}
  @media(min-width:680px){.add-lead-form{grid-template-columns:repeat(2,1fr)}.add-lead-form .field--full{grid-column:1/-1}}
  .add-lead-form .field{display:flex;flex-direction:column;gap:.4rem}
  .add-lead-form label{font-size:.76rem;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
  .add-lead-form input,.add-lead-form select,.add-lead-form textarea{
    background:var(--ground);border:1px solid var(--line);color:var(--bone);
    font-family:var(--body);font-size:.95rem;padding:.7rem .85rem;border-radius:6px;width:100%;
  }
  .add-lead-form select option:disabled{color:#6b7565}
  .add-lead-form textarea{min-height:6rem;resize:vertical}
  .add-lead-form input:focus-visible,.add-lead-form select:focus-visible,.add-lead-form textarea:focus-visible{
    outline:2px solid var(--bone);outline-offset:1px;
  }
  .add-lead-form .consent{display:flex;gap:.6rem;align-items:flex-start;font-size:.82rem;color:var(--muted)}
  .add-lead-form .consent input{margin-top:.2rem;width:1rem;height:1rem;accent-color:var(--clay);flex:none}
  .add-lead-actions{display:flex;align-items:center;gap:.85rem;flex-wrap:wrap}
  .btn-primary{
    font-family:var(--display);font-weight:700;font-size:.92rem;color:var(--bone);
    background:var(--clay);border:0;border-radius:6px;padding:.75rem 1.4rem;cursor:pointer;
  }
  .btn-primary:hover{background:var(--clay-lift)}
  .btn-primary:disabled{opacity:.6;cursor:not-allowed}
  .btn-secondary{
    font-family:var(--body);font-weight:600;font-size:.88rem;color:var(--muted);
    background:transparent;border:1px solid var(--line);border-radius:6px;padding:.75rem 1.2rem;cursor:pointer;
  }
  .btn-secondary:hover{color:var(--bone);border-color:var(--line-soft)}
  .form-status{font-size:.85rem;margin:0;min-height:1.2em}
  .form-status--ok{color:var(--good)}
  .form-status--err{color:var(--clay-step)}

  .badge--source-web{background:rgba(242,238,227,.08);color:var(--muted)}
  .badge--source-manual{background:rgba(198,117,97,.16);color:var(--clay-step)}

  .row-actions{display:flex;gap:.5rem;flex-wrap:wrap}
  .row-btn{
    font-family:var(--body);font-size:.8rem;font-weight:600;
    background:transparent;border:1px solid var(--line);border-radius:6px;
    padding:.4rem .75rem;cursor:pointer;transition:all .12s ease;color:var(--muted);
  }
  .row-btn--edit:hover{color:var(--bone);border-color:var(--bone)}
  .row-btn--delete{color:var(--clay-step);border-color:rgba(198,117,97,.35)}
  .row-btn--delete:hover{background:var(--clay);border-color:var(--clay);color:var(--bone)}

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
  <img class="bg-buck" src="/assets/logo-head.png" alt="" aria-hidden="true">
  <div class="wrap">
    <div class="topbar">
      <div class="brand">
        <img class="brand__lockup" src="/assets/lockup-nav.png" alt="Prime Buck Junk Removal" width="180" height="53">
        <span class="brand__tag">Admin dashboard</span>
      </div>
      <a class="logout-link" href="/admin/logout">Log out</a>
    </div>

    <h1>Quote requests</h1>
    <p class="sub">Newest first — refresh to see new submissions.</p>

    ${featureNotice}

    <div class="stats">
      <div class="stat"><div class="stat__n">${count}</div><div class="stat__label">Total leads</div></div>
      <div class="stat"><div class="stat__n">${thisWeek}</div><div class="stat__label">Past 7 days</div></div>
      <div class="stat"><div class="stat__n">${smsOptIns}</div><div class="stat__label">SMS opt-ins</div></div>
      <div class="stat"><div class="stat__n">${withPhotos}</div><div class="stat__label">With photos</div></div>
      ${hasContactTracking ? `<div class="stat stat--flag"><div class="stat__n">${needsContact}</div><div class="stat__label">Needs contact</div></div>` : ""}
    </div>

    ${hasContactTracking || hasSource ? `
    <div class="actionbar">
      ${hasContactTracking ? `
      <div class="filterbar">
        <button type="button" class="filter-btn is-active" data-filter="all">All</button>
        <button type="button" class="filter-btn" data-filter="pending">Needs contact</button>
        <button type="button" class="filter-btn" data-filter="done">Contacted</button>
      </div>` : `<div></div>`}
      ${hasSource ? `<button type="button" class="btn-add-lead" id="addLeadBtn">+ Add lead</button>` : ""}
    </div>` : ""}

    ${hasSource ? renderAddLeadPanel() : ""}

    <div class="card">
      <table>
        <thead>
          <tr><th>Received</th><th>Name</th><th>Phone</th><th>Email</th><th>Message</th><th>SMS OK</th><th>Photos</th>${contactTh}${sourceTh}<th>Actions</th></tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </div>

  ${(hasContactTracking || hasSource) ? `<script>
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

    // ---- Add / edit lead panel ----
    var addLeadBtn = document.getElementById('addLeadBtn');
    var addLeadPanel = document.getElementById('addLeadPanel');
    var addLeadCancel = document.getElementById('addLeadCancel');
    var addLeadForm = document.getElementById('addLeadForm');
    var panelTitle = document.getElementById('leadPanelTitle');
    var panelSub = document.getElementById('leadPanelSub');
    var panelSubmit = document.getElementById('leadPanelSubmit');
    var sourceField = document.getElementById('al-source');

    function resetPanelToAddMode() {
      addLeadForm.reset();
      document.getElementById('al-id').value = '';
      if (panelTitle) panelTitle.textContent = 'Add a lead manually';
      if (panelSub) panelSub.textContent = 'For leads that came in by phone, text, referral, etc. — not through the website form.';
      if (panelSubmit) panelSubmit.textContent = 'Save lead';
      if (sourceField) sourceField.disabled = false;
      var status = document.getElementById('addLeadStatus');
      if (status) { status.textContent = ''; status.className = 'form-status'; }
    }

    if (addLeadBtn && addLeadPanel) {
      addLeadBtn.addEventListener('click', function () {
        var wasHidden = addLeadPanel.hidden;
        resetPanelToAddMode();
        addLeadPanel.hidden = !wasHidden;
        if (!addLeadPanel.hidden) {
          var nameField = document.getElementById('al-name');
          if (nameField) nameField.focus();
        }
      });
    }
    if (addLeadCancel && addLeadPanel && addLeadForm) {
      addLeadCancel.addEventListener('click', function () {
        addLeadPanel.hidden = true;
        resetPanelToAddMode();
      });
    }

    // Edit buttons — prefill the panel from the row's data attributes.
    document.querySelectorAll('.row-btn--edit').forEach(function (btn) {
      btn.addEventListener('click', function () {
        resetPanelToAddMode();
        document.getElementById('al-id').value = btn.getAttribute('data-id');
        document.getElementById('al-name').value = btn.getAttribute('data-name') || '';
        document.getElementById('al-phone').value = btn.getAttribute('data-phone') || '';
        document.getElementById('al-email').value = btn.getAttribute('data-email') || '';
        document.getElementById('al-message').value = btn.getAttribute('data-message') || '';
        document.getElementById('al-sms').checked = btn.getAttribute('data-sms') === '1';

        var leadSource = btn.getAttribute('data-source') || '';
        if (sourceField) {
          if (leadSource === 'Website') {
            // Website leads keep their source locked — show it but disable changing it.
            var websiteOption = sourceField.querySelector('option[value="Website"]');
            if (websiteOption) websiteOption.disabled = false;
            sourceField.value = 'Website';
            sourceField.disabled = true;
            if (websiteOption) websiteOption.disabled = true; // restore lock on the option itself
          } else {
            sourceField.disabled = false;
            sourceField.value = leadSource;
          }
        }

        if (panelTitle) panelTitle.textContent = 'Edit lead';
        if (panelSub) panelSub.textContent = 'Editing ' + (btn.getAttribute('data-name') || 'this lead') + '.' + (leadSource === 'Website' ? ' Source is locked for website leads.' : '');
        if (panelSubmit) panelSubmit.textContent = 'Save changes';

        addLeadPanel.hidden = false;
        addLeadPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.getElementById('al-name').focus();
      });
    });

    // Delete buttons.
    document.querySelectorAll('.row-btn--delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        var name = btn.getAttribute('data-name') || 'this lead';
        if (!window.confirm('Delete the lead for ' + name + '? This cannot be undone.')) return;

        btn.disabled = true;
        fetch('/api/lead/' + encodeURIComponent(id), { method: 'DELETE' })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data.ok) throw new Error(data.error || 'failed');
            window.location.reload();
          })
          .catch(function () {
            alert('Could not delete — please try again.');
            btn.disabled = false;
          });
      });
    });

    if (addLeadForm) {
      addLeadForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var status = document.getElementById('addLeadStatus');
        var submitBtn = addLeadForm.querySelector('button[type="submit"]');
        var editId = document.getElementById('al-id').value;
        var payload = {
          name: addLeadForm.name.value.trim(),
          phone: addLeadForm.phone.value.trim(),
          email: addLeadForm.email.value.trim(),
          message: addLeadForm.message.value.trim(),
          source: addLeadForm.source.value,
          smsConsent: addLeadForm.sms_consent.checked,
        };
        var needsSource = !editId || (sourceField && !sourceField.disabled);
        if (!payload.name || !payload.phone || !payload.message || (needsSource && !payload.source)) {
          status.textContent = 'Please fill in name, phone, source and message.';
          status.className = 'form-status form-status--err';
          return;
        }
        submitBtn.disabled = true;
        status.textContent = 'Saving…';
        status.className = 'form-status';

        var url = editId ? '/api/lead/' + encodeURIComponent(editId) : '/api/lead';
        var method = editId ? 'PUT' : 'POST';

        fetch(url, {
          method: method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data.ok) throw new Error(data.error || 'failed');
            status.textContent = 'Saved — refreshing…';
            status.className = 'form-status form-status--ok';
            setTimeout(function () { window.location.reload(); }, 500);
          })
          .catch(function () {
            status.textContent = 'Could not save — please try again.';
            status.className = 'form-status form-status--err';
            submitBtn.disabled = false;
          });
      });
    }
  })();
  </script>` : ""}
</body>
</html>`;
}
