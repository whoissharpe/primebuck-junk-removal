# Prime Buck Junk Removal

Marketing site for Prime Buck Junk Removal, Jacksonville FL.
Built and maintained by Sharpe Digital.

**Live:** _(add your Cloudflare Pages URL here once deployed)_

## Stack

Plain static HTML, CSS and JavaScript. No build step, no framework,
no dependencies. Open `index.html` in a browser to work on it locally.

## Structure

```
index.html    single page, all sections
styles.css    all styling; brand tokens are at the top of the file
script.js     progressive enhancement only, site works without JS
assets/       logo lockups, favicon, apple touch icon
```

## Brand tokens

Defined as CSS custom properties at the top of `styles.css`:

| Token | Value | Use |
|---|---|---|
| `--brand` | `#31461E` | forest green, client's existing brand colour |
| `--ground` | `#131A0E` | page background |
| `--raised` | `#1B2614` | alternating section background |
| `--bone` | `#F2EEE3` | primary text and logo |
| `--muted` | `#A8B39C` | secondary text |
| `--clay` | `#B5462F` | CTAs only, nowhere else |

## Deploying

Connected to Cloudflare Pages. Pushing to `main` triggers a deploy.

- Build command: _(none)_
- Build output directory: `/`

## Before going live

The quote form posts to Formspree. Replace `YOUR_FORM_ID` in `index.html`
with a real endpoint or submissions go nowhere.

## Notes

- Hero video and gallery photos are hosted externally and referenced by URL.
- Hero animation pauses off-screen and is disabled under `prefers-reduced-motion`.
- LocalBusiness JSON-LD schema includes phone, hours and all 11 service areas.
