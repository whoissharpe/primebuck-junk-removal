// GET /admin/logout — forces the browser to drop its cached Basic Auth
// credentials for /admin.
//
// HTTP Basic Auth has no real server-side "session" to end — the browser
// just remembers the credentials and resends them automatically. The only
// reliable way to force a re-prompt is to keep rejecting requests to this
// same realm with 401, regardless of what credentials are sent. When the
// browser retries with its cached creds and gets 401 again, it treats them
// as wrong and shows a fresh login prompt. If the person cancels that
// prompt, they land on this page's message instead of a generic error.

export async function onRequestGet() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Logged out — Prime Buck Junk Removal</title>
<link rel="icon" href="/assets/favicon-32.png" sizes="32x32">
<link rel="icon" href="/assets/favicon.png" sizes="64x64">
<style>
  body{
    margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#131A0E;color:#F2EEE3;font-family:"Inter Tight",system-ui,-apple-system,sans-serif;
    text-align:center;padding:2rem;
  }
  .card{max-width:26rem}
  img{width:48px;height:48px;margin-bottom:1.25rem}
  h1{font-size:1.4rem;margin:0 0 .6rem;letter-spacing:-.01em}
  p{color:#A8B39C;font-size:.95rem;line-height:1.55;margin:0 0 1.5rem}
  a{
    display:inline-block;background:#B5462F;color:#F2EEE3;text-decoration:none;
    font-weight:700;padding:.75rem 1.5rem;border-radius:6px;font-size:.92rem;
  }
  a:hover{background:#C8502F}
</style>
</head>
<body>
  <div class="card">
    <img src="/assets/logo-head.png" alt="" aria-hidden="true">
    <h1>You're logged out</h1>
    <p>Your admin session has been cleared. Close this tab, or log back in below.</p>
    <a href="/admin">Log back in</a>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Prime Buck Admin"',
      "content-type": "text/html; charset=utf-8",
    },
  });
}
