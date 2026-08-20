// Shared Basic Auth check, used by /admin and any admin-only API route
// (e.g. /api/contact). Checked against the ADMIN_PASSWORD secret set in
// Cloudflare Pages > Settings > Variables and secrets. Username is not
// checked, only the password.

export function isAuthorized(header, expected) {
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

// Returns a 401 Response if unauthorized, or null if the request is authorized.
export function requireAuth(request, env, realm) {
  const auth = request.headers.get("Authorization");
  if (!isAuthorized(auth, env.ADMIN_PASSWORD)) {
    return new Response("Authentication required.", {
      status: 401,
      headers: { "WWW-Authenticate": `Basic realm="${realm || "Prime Buck Admin"}"` },
    });
  }
  return null;
}
