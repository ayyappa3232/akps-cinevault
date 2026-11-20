# CineVault — Only the movies worth watching.
Static PWA. No backend, no build step, no API keys.

## Run
`python3 -m http.server 8000` → http://localhost:8000
(Opening index.html directly works, but in-page trailers and the service worker need http/https.)

## Add movies — see HOW_TO_ADD_MOVIES.md
Only `movies.js` needs editing. `node tools/check.js` validates it.

## Deploy (GitHub Pages)
Push the folder → Settings → Pages → branch `main`, root. Bump `V` in `service-worker.js` each deploy.

## Troubleshooting
- Edited movies.js but nothing changed? Hard refresh (Cmd/Ctrl+Shift+R). If a "Browser edits active" banner shows, click "Use movies.js".
- Yellow/red banner at top = catalogue mistakes; it tells you which movie and field.
- Trailer shows an error? Serve over http(s); file:// has no referrer so YouTube refuses to embed.

## Run with a server (recommended)
`npm start` → http://localhost:8000 (no installs needed). Required for in-page trailers.

## Discover (optional, TMDB)
Free key at themoviedb.org → Settings → API. Paste it in the app (Discover or Settings). It is stored only in your browser, never in the code. Movies not in movies.js are tagged TMDB; use "Add to my catalogue" to promote one, then export movies.js.

## Code map (where to find things)

| File | What it does |
| --- | --- |
| `index.html` | Page shell: top bar, sidebar, bottom tabs, `<main>`, dialog, script tags (order matters). |
| `styles.css` | All styling. Colours/spacing are variables in `:root`. Sections are labelled with comments. |
| `movies.js` | **The catalogue** (the only file you edit to add movies) + OTT platform link templates. |
| `app.js` | App logic. Read the file-map comment at the top. Routes live in the `views` object. |
| `ui-select.js` | Custom dropdown that replaces native `<select>` (native lists can't be styled). |
| `tmdb.js` | Optional live discovery from TMDB. |
| `storage.js` | IndexedDB + localStorage wrapper. |
| `recommendations.js` | Similar movies, "Picked for you", movie of the day. |
| `service-worker.js` | Offline cache. Bump `CACHE_VERSION` on every deploy. |
| `tools/check.js` | `npm run check` validates `movies.js` and lists missing posters. |
| `tools/serve.js` | `npm start` local server (needed for in-page trailers). |

### How to extend
- **New page:** add an entry to `views` (app.js), `NAV_ITEMS` and `NAV_ICONS`.
- **New button action:** give the button `data-act="myAction"` and add a `case "myAction"` in the global click handler.
- **New filter:** add a key to `DEFAULT_FILTERS`, a control in `filterBarHtml`, and a condition in `applyFilters`.
- **New dropdown:** just write a normal `<select>`; `CineSelect.enhance()` styles it after each render.

### Code style
Everything is formatted with Prettier (`npm run format`, config in `.prettierrc`). Functions ending in `Html`
return strings; `render*`, `open*`, `update*` change the page. All text put into HTML goes through `escapeHtml()`.
