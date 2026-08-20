PRIME BUCK JUNK REMOVAL — website files
=======================================

TO PUT IT ONLINE — CLOUDFLARE PAGES (free, ~2 minutes)
1. Go to dash.cloudflare.com and sign in (or create a free account).
2. In the left sidebar: Workers & Pages > Create > Pages > Upload assets.
3. Give it a project name (e.g. "prime-buck-junk-removal").
4. Drag this entire folder onto the upload area, or select all the files
   inside it (index.html, styles.css, script.js, assets/) and upload them —
   do not upload the .zip itself, upload the unzipped contents.
5. Click Deploy. You'll get a live URL like prime-buck-junk-removal.pages.dev
   within about 30 seconds.
6. To use primebuckjunkremoval.com instead: open the project > Custom domains
   > Set up a custom domain, and follow the DNS steps Cloudflare gives you.
   If the domain is already on Cloudflare, this is usually automatic.

Updating the site later: go to the project > Deployments > Upload a new
deployment version, and drag the updated folder in again. Or connect it to
a GitHub repo if you want push-to-deploy.

BEFORE YOU GO LIVE — ONE REQUIRED CHANGE
The quote form needs somewhere to send submissions.
1. Make a free account at formspree.io and create a form.
2. They give you an endpoint like https://formspree.io/f/abcdwxyz
3. Open index.html, find YOUR_FORM_ID (it is on one line, near the
   bottom in the quote section), and replace that whole URL.
Until you do this, the form will not deliver anything.

FILES
index.html   the page
styles.css   all styling, brand colours at the very top
script.js    small enhancements only; the site works without it
assets/      logo, lockup, favicon, apple touch icon

BRAND COLOURS (top of styles.css)
forest green #31461E · near black #131A0E · bone #F2EEE3
muted sage #A8B39C · clay red #B5462F (buttons only)

NOTES
- Fonts load from Fontshare and Google Fonts. If either is unreachable
  the page falls back to system fonts and still looks correct.
- The hero video and gallery photos are hosted on Higgsfield's CDN and
  loaded by URL — nothing to upload for those, they just need internet
  access to load, same as any other external image on a website.
- The hero animation pauses when scrolled out of view, and is disabled
  entirely for visitors who have reduced motion turned on.
- LocalBusiness schema is included with the phone number, hours and all
  eleven service areas, which helps with local search.
- Cloudflare Pages serves everything over HTTPS automatically, with no
  extra setup — same as Netlify.
