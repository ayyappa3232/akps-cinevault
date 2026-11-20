/**
 * app.js — CineVault application logic (plain JavaScript, no framework, no build step).
 *
 * FILE MAP (top to bottom)
 *   1. Helpers ........... qs, escapeHtml, showToast, downloadFile
 *   2. State ............. movies (the catalogue), userData (watchlist, reviews…), filters
 *   3. HTML builders ..... small functions that RETURN HTML strings (cards, rails, dialogs)
 *   4. views ............. one function per route (#/home, #/all, …) returning the page HTML
 *   5. Dialogs ........... movie details, add/edit form, validation
 *   6. Event handlers .... ONE delegated click handler reads data-* attributes
 *   7. Boot .............. loads storage + catalogue, renders the first route
 *
 * DATA FLOW
 *   movies.js → window.MOVIES → normalizeMovie() → `movies`
 *   storage.js (IndexedDB) → `userData`
 *   renderRoute() reads location.hash → calls views[route]() → writes the HTML into <main>.
 *
 * CONVENTIONS
 *   • Functions ending in Html return strings; functions starting render / open / update touch the DOM.
 *   • Every dynamic value that goes into HTML passes through escapeHtml() (prevents XSS).
 *   • Buttons carry data-* attributes (data-open, data-tg, data-act, …); the click handler
 *     near the bottom of this file decides what each one does.
 *   • Other files: movies.js (data), storage.js, recommendations.js, tmdb.js, ui-select.js.
 */
/**
 * Shorthand for querySelector (qs) and querySelectorAll (qsAll, returns a real array).
 */
const qs = (s, r = document) => r.querySelector(s),
  qsAll = (s, r = document) => [...r.querySelectorAll(s)];
/**
 * Escape text before putting it into HTML. ALWAYS use this for movie/user text.
 */
const escapeHtml = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
/**
 * Sidebar entries: [route, label]. Route "all" ↔ URL #/all. Add a view in `views` to add a page.
 */
const NAV_ITEMS = [
  ["home", "Home"],
  ["all", "All Movies"],
  ["discover", "Discover"],
  ["trending", "Trending"],
  ["must", "Must Watch"],
  ["gems", "Hidden Gems"],
  ["ott", "OTT Explorer"],
  ["collections", "Collections"],
  ["watchlist", "Watchlist"],
  ["watched", "Watched"],
  ["favourites", "Favourites"],
  ["recent", "Recently Viewed"],
  ["stats", "Statistics"],
  ["settings", "Settings"],
  ["manage", "Manage Movies"],
];
/**
 * Simple text icon per route (shown in sidebar and mobile tab bar).
 */
const NAV_ICONS = {
  // #/home: carousel, today's pick, genre chips, rails
  home: "⌂",
  // #/all: filter panel + results
  all: "▦",
  discover: "✦",
  // #/trending
  trending: "↗",
  // #/must
  must: "★",
  // #/gems
  gems: "◆",
  // #/ott: platform tiles, then movies on the chosen platform
  ott: "▶",
  // #/collections: grouped by movie.collections
  collections: "❏",
  // #/watchlist
  watchlist: "＋",
  // #/watched
  watched: "✓",
  // #/favourites
  favourites: "♥",
  // #/recent
  recent: "◷",
  // #/stats: counts, average rating, hours, bar charts
  stats: "▮",
  // #/settings: backup, preferences, TMDB key, danger zone
  settings: "⚙",
  // #/manage: add/edit/delete, export, validate
  manage: "✎",
};
/**
 * The 7 allowed values for movie.category (validated; see movies.js).
 */
const CATEGORIES = [
  "Indian",
  "Hollywood",
  "Korean",
  "International",
  "Japanese",
  "Documentaries",
  "Animation",
];
/**
 * Runtime state.
 *  movies ............ the active catalogue (movies.js, or your browser edits from Manage Movies)
 *  userData .......... watchlist / watched / favs (arrays of ids), reviews {id: {rating, review}}, history
 *  savedExternalMovies  TMDB movies you saved to a list (kept so they still show after reload)
 *  discoverCache ..... TMDB results from the current Discover session
 *  usingBrowserEdits . true when Manage Movies edits override movies.js
 *  catalogueIssues ... validation messages shown in the yellow banner
 */
let savedExternalMovies = {},
  discoverCache = {},
  catalogueIssues = [],
  usingBrowserEdits = false,
  catalogueFingerprint = "",
  movies = [],
  userData = { watchlist: [], watched: [], favs: [], reviews: {}, history: [] },
  compareList = [];
/**
 * Filter state for the All Movies page. Empty string = "no filter".
 */
const DEFAULT_FILTERS = {
  q: "",
  cat: "",
  lang: "",
  genre: "",
  ott: "",
  country: "",
  year: "",
  imdb: "",
  prate: "",
  flag: "",
  sort: "added",
};
let filters = { ...DEFAULT_FILTERS };
/**
 * Small pop-up message at the bottom of the screen.
 */
const showToast = (movie) => {
  const t = qs("#toast");
  t.textContent = movie;
  t.classList.add("show");
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => t.classList.remove("show"), 2200);
};
/**
 * If a movie has no poster, assume assets/posters/<id>.jpg (falls back to a generated cover).
 */
const withDefaultPoster = (n) => ((n.poster = n.poster || `assets/posters/${n.id}.jpg`), n);
/**
 * Fill in defaults so the rest of the app can rely on every field existing (cast is always an array, etc.).
 */
const normalizeMovie = (movie) =>
  withDefaultPoster({
    original: "",
    backdrop: "",
    imdb: null,
    duration: null,
    country: "",
    director: "",
    cast: [],
    why: "",
    trailer: "",
    collections: [],
    similar: [],
    must: false,
    gem: false,
    trending: false,
    featured: false,
    availability: "unverified",
    category: "International",
    genres: [],
    ott: [],
    added: "",
    ...movie,
  });
/**
 * Persist watchlist/watched/favs/reviews/history to IndexedDB.
 */
const saveUserData = () => Promise.all(Object.keys(userData).map((k) => Store.set(k, userData[k])));
/**
 * Trigger a browser download from text (used by Export buttons).
 */
const downloadFile = (name, text, type = "application/json") => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
/**
 * Find a movie in the catalogue, saved TMDB movies, or current Discover results.
 */
const getMovieById = (id) =>
  movies.find((movie) => movie.id === id) || savedExternalMovies[id] || discoverCache[id];
const uniqueSorted = (a) => [...new Set(a)].sort();
const isInList = (k, id) => userData[k].includes(id);
/**
 * Add/remove a movie id in watchlist | watched | favs. Returns true when added.
 */
function toggleInList(k, id) {
  const mm = getMovieById(id);
  if (mm && mm.source === "tmdb") {
    savedExternalMovies[id] = mm;
    Store.set("ext", savedExternalMovies);
  }
  const i = userData[k].indexOf(id);
  i < 0 ? userData[k].unshift(id) : userData[k].splice(i, 1);
  saveUserData();
  return i < 0;
}
/**
 * Stable colour (0–360) derived from the movie id, used for generated covers.
 */
const posterHue = (movie) => {
  let h = 0;
  for (const c of movie.id || "x") h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};
/**
 * Poster stand-in shown when there is no image file: tinted gradient, film-strip edge, title.
 */
const generatedCoverHtml = (movie) => `<div class="art" style="--h:${posterHue(movie)}">
<b>${escapeHtml(movie.title)}</b>
<i>${movie.year || ""}</i>
</div>`;
/**
 * Poster block: generated cover underneath, real <img> on top (removed automatically if it fails to load).
 */
const posterHtml = (movie) =>
  `<div class="ph">${generatedCoverHtml(movie)}${movie.poster ? `<img loading="lazy" src="${escapeHtml(movie.poster)}" alt="${escapeHtml(movie.title)} poster" onerror="this.remove()">` : ""}</div>`;
/**
 * One movie card: poster, rating pill, quick watchlist button, title.
 */
function movieCardHtml(movie) {
  const id = escapeHtml(movie.id);
  const title = escapeHtml(movie.title);
  const inWatchlist = isInList("watchlist", movie.id);
  const fromTmdb = movie.source === "tmdb";
  const rating = movie.imdb || movie.tmdb; // curated movies show IMDb, TMDB movies show TMDB's score

  const ratingPill = rating
    ? `<span class="pill">★ ${(+rating).toFixed(1)}${fromTmdb ? " · TMDB" : ""}</span>`
    : "";
  // In Discover every card is tagged so curated and TMDB movies can be told apart.
  const sourceTag = fromTmdb
    ? ' <span class="src ext">TMDB</span>'
    : window._disc
      ? ' <span class="src cur">Curated</span>'
      : "";

  return `
    <article class="card">
      <button class="open" data-open="${id}" aria-label="Open ${title}">
        ${posterHtml(movie)}${ratingPill}
      </button>
      <button class="q ${inWatchlist ? "on" : ""}" data-tg="watchlist" data-id="${id}"
              aria-label="Toggle watchlist" title="Watchlist">${inWatchlist ? "✓" : "＋"}</button>
      <div class="t">
        <b>${title}</b>
        <small>${movie.year || ""} · ${escapeHtml(movie.lang)}${sourceTag}</small>
      </div>
    </article>`;
}
/**
 * Horizontal scrolling row with Netflix-style arrows (arrows shown by updateRailArrows).
 */
const railHtml = (t, l, link) =>
  l.length
    ? `<div class="sec">
<h2>${escapeHtml(t)}</h2>${link ? `<a href="#/${link}">See all</a>` : ""}</div>
<div class="railw">
<button class="rb l" data-rail="-1" aria-label="Scroll left" hidden>‹</button>
<div class="rail">${l.map(movieCardHtml).join("")}</div>
<button class="rb r" data-rail="1" aria-label="Scroll right">›</button>
</div>`
    : "";
/**
 * Banners at the top of every page: "browser edits active" and catalogue validation issues.
 */
function bannerHtml() {
  return (
    (usingBrowserEdits
      ? `<div class="note">
<b>Browser edits active.</b> You are seeing changes saved in Manage Movies, not movies.js. <button class="btn" data-act="resetcat">Use movies.js</button>
</div>`
      : "") +
    (catalogueIssues.length
      ? `<div class="note warn">
<b>${catalogueIssues.length} catalogue issue${catalogueIssues.length > 1 ? "s" : ""}:</b> ${catalogueIssues.slice(0, 4).map(escapeHtml).join(" · ")}${catalogueIssues.length > 4 ? " …" : ""}</div>`
      : "")
  );
}
/**
 * Responsive grid of cards, or an empty-state message.
 */
const gridHtml = (l, empty = "Nothing here yet. Open a movie and use Watchlist, Watched or Favourite.") =>
  l.length
    ? `<div class="grid">${l.map(movieCardHtml).join("")}</div>`
    : `<div class="empty">${escapeHtml(empty)}</div>`;
const sectionRail = (t, l) => railHtml(t, l, "");
/**
 * Filter + sort the catalogue according to the `filters` object.
 */
function applyFilters(list) {
  const f = filters,
    q = f.q.toLowerCase();
  let r = list.filter(
    (movie) =>
      (!q ||
        [
          movie.title,
          movie.original,
          movie.director,
          movie.cast.join(" "),
          movie.genres.join(" "),
          movie.lang,
        ]
          .join(" ")
          .toLowerCase()
          .includes(q)) &&
      (!f.cat || movie.category === f.cat) &&
      (!f.lang || movie.lang === f.lang) &&
      (!f.genre || movie.genres.includes(f.genre)) &&
      (!f.ott || movie.ott.some((o) => o.p === f.ott)) &&
      (!f.country || movie.country === f.country) &&
      (!f.year || movie.year >= +f.year) &&
      (!f.imdb || (movie.imdb || 0) >= +f.imdb) &&
      (!f.prate || (userData.reviews[movie.id]?.rating || 0) >= +f.prate) &&
      (!f.flag || movie[f.flag]),
  );
  const s = {
    added: (a, b) => (b.added || "").localeCompare(a.added || ""),
    imdb: (a, b) => (b.imdb || 0) - (a.imdb || 0),
    year: (a, b) => b.year - a.year,
    old: (a, b) => a.year - b.year,
    title: (a, b) => a.title.localeCompare(b.title),
    mine: (a, b) => (userData.reviews[b.id]?.rating || 0) - (userData.reviews[a.id]?.rating || 0),
  };
  return r.sort(s[f.sort]);
}
const optionsHtml = (a, v) =>
  `<option value="">All</option>` +
  a.map((x) => `<option${String(x) === String(v) ? " selected" : ""}>${escapeHtml(x)}</option>`).join("");
/**
 * The labelled filter panel on All Movies.
 */
function filterBarHtml() {
  const sl = (k, l, a) => `<label class="sel">
<span>${l}</span>
<select data-f="${k}">
<option value="">All</option>${a.map((x) => `<option${filters[k] == x ? " selected" : ""}>${escapeHtml(x)}</option>`).join("")}</select>
</label>`,
    ch = (k, l, a) => `<label class="sel">
<span>${l}</span>
<select data-f="${k}">${a.map(([v, t]) => `<option value="${v}"${filters[k] == v ? " selected" : ""}>${t}</option>`).join("")}</select>
</label>`;
  return `<div class="filters">
<input data-f="q" type="search" placeholder="Search title, cast, director…" value="${escapeHtml(filters.q)}" aria-label="Search">
<div class="fg">${sl("cat", "Category", CATEGORIES)}${sl("lang", "Language", uniqueSorted(movies.map((movie) => movie.lang)))}${sl("genre", "Genre", uniqueSorted(movies.flatMap((movie) => movie.genres)))}${sl("ott", "Streaming on", Object.keys(PLATFORMS))}${sl("country", "Country", uniqueSorted(movies.map((movie) => movie.country).filter(Boolean)))}${sl("year", "Released from", uniqueSorted(movies.map((movie) => movie.year)))}${sl("imdb", "IMDb at least", [9, 8.5, 8, 7.5, 7])}${sl("prate", "My rating at least", [5, 4, 3, 2, 1])}${ch(
    "flag",
    "Show",
    [
      ["", "Everything"],
      ["must", "Must watch"],
      ["gem", "Hidden gems"],
    ],
  )}${ch("sort", "Sort by", [
    ["added", "Newest added"],
    ["imdb", "IMDb rating"],
    ["year", "Year, newest"],
    ["old", "Year, oldest"],
    ["title", "Title A–Z"],
    ["mine", "My rating"],
  ])}</div>
<button class="btn" data-act="clear">Clear filters</button>
</div>`;
}
/**
 * ROUTES. views.<name>() returns the HTML for #/<name>.
 * To add a page: add an entry here and a line in NAV_ITEMS (and NAV_ICONS).
 */
const views = {
  home() {
    if (!movies.length) return `<div class="empty">Your catalogue is empty. Add movies in movies.js.</div>`;
    const f = movies.filter((movie) => movie.featured),
      sl = (f.length ? f : [...movies].sort((a, b) => (b.imdb || 0) - (a.imdb || 0))).slice(0, 6),
      d = Reco.daily(movies),
      g = uniqueSorted(movies.flatMap((movie) => movie.genres));
    const slide = (movie) => `<div class="slide" style="--h:${posterHue(movie)}">${
      movie.backdrop
        ? `<img class="bd" src="${escapeHtml(movie.backdrop)}" alt="" loading="lazy" onerror="this.remove()">
<div class="shade">
</div>`
        : ""
    }<div class="hin">
<span class="badge gold">${movie === d ? "Movie of the day" : movie.featured ? "Featured" : "Top pick"}</span>
<h1>${escapeHtml(movie.title)}</h1>
<p class="meta">${movie.year} · ${escapeHtml(movie.lang)} · ${escapeHtml(movie.genres.join(", "))}${movie.imdb ? " · ★ " + movie.imdb : ""}</p>
<p class="lead">${escapeHtml(movie.why || movie.synopsis)}</p>
<div class="row">
<button class="btn pri" data-open="${escapeHtml(movie.id)}">View details</button>
<button class="btn" data-tg="watchlist" data-id="${escapeHtml(movie.id)}">＋ Watchlist</button>
</div>
</div>
<div class="hpost">${posterHtml(movie)}</div>
</div>`;
    return `<section class="car" aria-roledescription="carousel" aria-label="Featured movies">
<div class="track">${sl.map(slide).join("")}</div>${
      sl.length > 1
        ? `<button class="cb l" data-car="-1" aria-label="Previous slide">‹</button>
<button class="cb r" data-car="1" aria-label="Next slide">›</button>
<div class="dots">${sl
            .map(
              (_, i) => `<button data-dot="${i}" aria-label="Go to slide ${i + 1}">
</button>`,
            )
            .join("")}</div>`
        : ""
    }</section>
  <p class="today">Today’s pick: <button class="link" data-open="${escapeHtml(d.id)}">${escapeHtml(d.title)}</button>
</p>
<div class="chips" aria-label="Browse by genre">${g.map((x) => `<button class="chip" data-genre="${escapeHtml(x)}">${escapeHtml(x)}</button>`).join("")}</div>
  ${railHtml("Picked for you", Reco.forYou(movies, userData, 10), "")}${railHtml(
    "Must watch",
    movies.filter((movie) => movie.must),
    "must",
  )}${railHtml(
    "Hidden gems",
    movies.filter((movie) => movie.gem),
    "gems",
  )}${railHtml(
    "Trending",
    movies.filter((movie) => movie.trending),
    "trending",
  )}`;
  },
  all() {
    return `<h1>All Movies</h1>${filterBarHtml()}<div id="res">
</div>`;
  },
  trending: () =>
    `<h1>Trending</h1>${gridHtml(
      movies.filter((movie) => movie.trending),
      "No trending titles. Set trending:true in movies.js.",
    )}`,
  must: () =>
    `<h1>Must Watch</h1>${gridHtml(
      movies.filter((movie) => movie.must),
      "No must-watch titles. Set must:true in movies.js.",
    )}`,
  gems: () =>
    `<h1>Hidden Gems</h1>${gridHtml(
      movies.filter((movie) => movie.gem),
      "No hidden gems yet. Set gem:true in movies.js.",
    )}`,
  ott() {
    const p = Object.keys(PLATFORMS),
      cnt = (x) => movies.filter((movie) => movie.ott.some((o) => o.p === x)).length;
    return `<h1>OTT Explorer</h1>
<p class="mut">Pick a platform to see which curated movies are listed there for India.</p>
<div class="tiles">${p
      .map(
        (x) => `<button class="tile ${filters.ott === x ? "on" : ""}" data-ott="${escapeHtml(x)}">
<b>${escapeHtml(x)}</b>
<small>${cnt(x)} movie${cnt(x) == 1 ? "" : "s"}</small>
</button>`,
      )
      .join("")}</div>${
      filters.ott
        ? `<div class="sec">
<h2>${escapeHtml(filters.ott)}</h2>
</div>` +
          gridHtml(
            movies.filter((movie) => movie.ott.some((o) => o.p === filters.ott)),
            "No movies listed for this platform yet.",
          )
        : '<div class="empty" style="margin-top:28px">Choose a platform above.</div>'
    }`;
  },
  collections() {
    return (
      `<h1>Collections</h1>` +
      (uniqueSorted(movies.flatMap((movie) => movie.collections))
        .map((c) =>
          sectionRail(
            c,
            movies.filter((movie) => movie.collections.includes(c)),
          ),
        )
        .join("") || '<div class="empty">No collections. Add collections:["Name"] to movies.</div>')
    );
  },
  watchlist: () => `<h1>Watchlist</h1>${gridHtml(userData.watchlist.map(getMovieById).filter(Boolean))}`,
  watched: () => `<h1>Watched</h1>${gridHtml(userData.watched.map(getMovieById).filter(Boolean))}`,
  favourites: () => `<h1>Favourites</h1>${gridHtml(userData.favs.map(getMovieById).filter(Boolean))}`,
  recent:
    () => `<h1>Recently Viewed</h1>${gridHtml(userData.history.map(getMovieById).filter(Boolean), "Movies you open appear here.")}<p>
<button class="btn" data-act="clearhist">Clear history</button>
</p>`,
  stats() {
    const w = userData.watched.map(getMovieById).filter(Boolean),
      rs = Object.values(userData.reviews)
        .map((r) => r.rating)
        .filter(Boolean),
      avg = rs.length ? (rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(1) : "–",
      mins = w.reduce((a, movie) => a + (movie.duration || 0), 0);
    const cnt = (f) => {
        const o = {};
        w.forEach((movie) => [].concat(f(movie)).forEach((k) => (o[k] = (o[k] || 0) + 1)));
        return Object.entries(o).sort((a, b) => b[1] - a[1]);
      },
      ch = (t, event) =>
        event.length
          ? `<h2>${t}</h2>
<div class="chart">${event
              .map(
                ([k, v]) => `<div>
<span style="width:110px">${escapeHtml(k)}</span>
<i style="width:${(v / event[0][1]) * 60}%">
</i>${v}</div>`,
              )
              .join("")}</div>`
          : "";
    return `<h1>Statistics</h1>
<p>Catalogue ${movies.length} · Watched ${w.length} · Watchlist ${userData.watchlist.length} · Favourites ${userData.favs.length} · Reviews ${Object.keys(userData.reviews).length}<br>Average rating ${avg}/5 · Hours watched ${(mins / 60).toFixed(1)}</p>${ch(
      "By category",
      cnt((movie) => movie.category),
    )}${ch(
      "By genre",
      cnt((movie) => movie.genres),
    )}${ch(
      "By language",
      cnt((movie) => movie.lang),
    )}${w.length ? "" : '<div class="empty">Mark movies as watched to see analytics.</div>'}`;
  },
  settings() {
    return `<h1>Settings</h1>
<h2>Backup</h2>
<p>All personal data stays in this browser. Export regularly.</p>
<button class="btn pri" data-act="export">Export backup (JSON)</button> <label class="btn">Import backup<input type="file" accept="application/json" id="imp" hidden>
</label>
  <h2>Preferences</h2>
<label>
<input type="checkbox" id="oled" ${Store.pref("oled") ? "checked" : ""}> Pure black background</label>
  <h2>Discover (TMDB)</h2>
<p>Optional. Paste your free TMDB key to browse movies beyond your curated list. It stays in this browser only.</p>
<div class="f">
<input id="tk" type="password" autocomplete="off" placeholder="TMDB API key or read access token" value="${escapeHtml(Store.pref("tmdbKey", ""))}">
<div class="row">
<button class="btn pri" data-act="savekey">Save key</button>
<button class="btn" data-act="clearkey">Remove key</button>
</div>
</div>
<h2>Danger zone</h2>
<button class="btn" data-act="wipe">Erase my personal data</button>
<h2>Shortcuts</h2>
<p>/ search · r random · h home · a all · w watchlist · m manage · Esc close</p>
<p>
<span id="inst">
</span>
</p>`;
  },
  // #/compare: side-by-side table (floating Compare button)
  compare() {
    const l = compareList.map(getMovieById).filter(Boolean);
    if (l.length < 2)
      return `<h1>Compare</h1>
<div class="empty">Add at least two movies from their detail pages.</div>`;
    const rows = [
      ["Year", (movie) => movie.year],
      ["IMDb", (movie) => movie.imdb || "–"],
      ["My rating", (movie) => userData.reviews[movie.id]?.rating || "–"],
      ["Language", (movie) => movie.lang],
      ["Genres", (movie) => movie.genres.join(", ")],
      ["Runtime", (movie) => (movie.duration ? movie.duration + " min" : "–")],
      ["Director", (movie) => movie.director || "–"],
      ["Where to watch", (movie) => movie.ott.map((o) => o.p).join(", ") || "–"],
    ];
    return `<h1>Compare</h1>
<table>
<tr>
<th>
</th>${l.map((movie) => `<th>${escapeHtml(movie.title)}</th>`).join("")}</tr>${rows
      .map(
        ([k, f]) => `<tr>
<th>${k}</th>${l.map((movie) => `<td>${escapeHtml(f(movie))}</td>`).join("")}</tr>`,
      )
      .join("")}</table>
<p>
<button class="btn" data-act="cmpclear">Clear</button>
</p>`;
  },
  manage() {
    return `<h1>Manage Movies</h1>
<p>Edits are saved in this browser. Export, paste into movies.js and redeploy to publish; GitHub Pages is not updated automatically.</p>
  <div class="toolbar">
<button class="btn pri" data-act="newm">＋ Add movie</button>
<div class="grp">
<button class="btn" data-act="expjson">Export JSON</button>
<button class="btn" data-act="expjs">Export movies.js</button>
</div>
<button class="btn" data-act="validate">Validate</button>
<button class="btn" data-act="resetcat">Reset to movies.js</button>
<input id="mq" type="search" placeholder="Filter ${movies.length} movies…" value="${escapeHtml(window._mq || "")}" aria-label="Filter movies">
</div>
<div id="vres">
</div>
<div class="mlist">${manageRowsHtml(window._mq || "")}</div>`;
  },
};
/**
 * Rows in Manage Movies (filtered by the search box).
 */
const manageRowsHtml = (q) => {
  q = q.toLowerCase();
  const l = movies.filter((movie) => !q || movie.title.toLowerCase().includes(q));
  return (
    l
      .map(
        (movie) => `<div class="mrow">
<div class="mth">${posterHtml(movie)}</div>
<div class="mi">
<b>${escapeHtml(movie.title)}</b>
<small>${movie.year} · ${escapeHtml(movie.lang)} · ${escapeHtml(movie.category)}${movie.ott.length ? " · " + escapeHtml(movie.ott.map((o) => o.p).join(", ")) : ""}</small>
</div>
<div class="ma">
<button class="btn" data-edit="${escapeHtml(movie.id)}">Edit</button>
<button class="btn danger" data-del="${escapeHtml(movie.id)}">Delete</button>
</div>
</div>`,
      )
      .join("") || '<div class="empty">No matches.</div>'
  );
};
/**
 * Home hero carousel: dots, previous/next, and auto-advance every 6.5s (paused on hover / hidden tab / open dialog).
 */
function initCarousel() {
  CineSelect.close();
  clearInterval(window._ct);
  const t = qs(".track");
  if (!t) return;
  const n = t.children.length,
    go = (i) => t.scrollTo({ left: i * t.clientWidth, behavior: "smooth" }),
    cur = () => Math.round(t.scrollLeft / (t.clientWidth || 1)),
    dots = () => qsAll(".dots button").forEach((b, i) => b.classList.toggle("on", i === cur()));
  t.addEventListener("scroll", dots, { passive: true });
  dots();
  window._cg = (d) => go((cur() + d + n) % n);
  window._cd = go;
  if (n > 1 && !matchMedia("(prefers-reduced-motion:reduce)").matches) {
    let hov = false;
    const c = qs(".car");
    c.onmouseenter = () => (hov = true);
    c.onmouseleave = () => (hov = false);
    window._ct = setInterval(() => {
      if (!hov && !document.hidden && !qs("#dlg").open && qs(".track") === t) window._cg(1);
    }, 6500);
  }
}
/**
 * Show the ‹ › arrows on a rail only when there is more content in that direction.
 */
function updateRailArrows() {
  qsAll(".railw").forEach((w) => {
    const r = w.querySelector(".rail");
    w.querySelector(".l").hidden = r.scrollLeft < 8;
    w.querySelector(".r").hidden = r.scrollLeft + r.clientWidth >= r.scrollWidth - 8;
  });
}
document.addEventListener(
  "scroll",
  (event) => {
    if (event.target.classList && event.target.classList.contains("rail")) updateRailArrows();
  },
  true,
);
addEventListener("resize", updateRailArrows);
views.discover = () => discoverView();
/**
 * Router. Reads the URL hash (#/home, #/movie/<id>), renders the matching view into <main>
 * and runs per-page setup (carousel, dropdown upgrade, Discover loading).
 */
function renderRoute() {
  const r = (location.hash.replace(/^#\/?/, "") || "home").split("/");
  const k = views[r[0]] ? r[0] : r[0] === "movie" ? window._last || "home" : "home";
  if (r[0] === "movie") {
    const movie = getMovieById(r[1]);
    if (movie) openMovieDialog(movie.id, true);
    return;
  }
  clearInterval(window._ct);
  window._last = k;
  window._disc = k === "discover";
  qs("#main").innerHTML = bannerHtml() + views[k]();
  qsAll("#nav a,#tabs a").forEach((a) => a.classList.toggle("on", a.dataset.k === k));
  CineSelect.enhance(qs("#main"));
  if (k === "all") renderResults();
  if (k === "home") initCarousel();
  if (k === "discover") initDiscover();
  updateRailArrows();
  if (k === "settings") renderInstallHint();
  qs("#nav").classList.remove("open");
  qs("#menuBtn").setAttribute("aria-expanded", "false");
  scrollTo(0, 0);
  updateCompareBar();
}
/**
 * Re-render only the results area of All Movies (keeps the filter controls and their focus).
 */
const renderResults = () => {
  const l = applyFilters(movies);
  qs("#res").innerHTML =
    `<p>${l.length} movie${l.length == 1 ? "" : "s"}</p>` +
    gridHtml(l, "No movies match. Try clearing filters.");
};
/**
 * Floating "Compare (n)" button.
 */
function updateCompareBar() {
  const b = qs("#cmpBar");
  b.hidden = compareList.length < 1;
  b.textContent = `Compare (${compareList.length})`;
}
/**
 * One streaming button + status badge. Click tries the app deep link first, then opens the website.
 * Status: verified | unverified | unavailable | live (live = from TMDB).
 */
function ottButtonHtml(movie, option) {
  const platform = PLATFORMS[option.p] || {}; // URL templates from movies.js
  const query = encodeURIComponent(`${movie.title} ${movie.year}`);
  // A movie-specific link wins; otherwise fall back to the platform's search page.
  const webUrl = option.web || (platform.web || "").replace("{q}", query);
  const appUrl = option.app || (platform.app || "").replace("{q}", query);
  const status = option.s || "unverified";
  const badgeClass =
    status === "verified" || status === "live" ? "ok" : status === "unavailable" ? "no" : "warn";
  const disabled = status === "unavailable" || !webUrl ? "disabled" : "";

  // data-app / data-web are read by the global click handler (tries the app, then the website).
  return `
    <span class="ottb">
      <button class="btn" data-app="${escapeHtml(appUrl)}" data-web="${escapeHtml(webUrl)}" ${disabled}>${escapeHtml(option.p)} ↗</button>
      <span class="badge ${badgeClass}">${status}</span>
    </span>`;
}
/**
 * Accepts a bare 11-character id or any YouTube URL; returns the id (or "").
 */
function youtubeId(input) {
  const fromUrl = String(input || "").match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/); // watch?v=ID, youtu.be/ID, embed/ID
  if (fromUrl) return fromUrl[1];
  return /^[\w-]{11}$/.test(input || "") ? input : ""; // already a bare 11-character id
}
/**
 * Movie details dialog. For TMDB movies it also loads cast/trailer/streaming on demand.
 */
function openMovieDialog(id, fromHash) {
  const movie = getMovieById(id);
  if (!movie) return;
  qs("#dlg").dataset.id = id;
  if (movie.source === "tmdb" && !movie._full && !movie._try && Tmdb.ready()) {
    movie._try = 1;
    Tmdb.detail(movie)
      .then(() => {
        if (qs("#dlg").open && qs("#dlg").dataset.id === id) openMovieDialog(id, true);
      })
      .catch(() => {});
  }
  userData.history = [id, ...userData.history.filter((x) => x !== id)].slice(0, 30);
  saveUserData();
  const rv = userData.reviews[id] || {},
    d = qs("#dlg"),
    y = youtubeId(movie.trailer),
    yurl = y
      ? "https://www.youtube.com/watch?v=" + y
      : "https://www.youtube.com/results?search_query=" +
        encodeURIComponent(movie.title + " " + movie.year + " official trailer");
  const tg = (k, l) =>
    `<button class="btn ${isInList(k, id) ? "on" : ""}" data-tg="${k}" data-id="${escapeHtml(id)}">${l}</button>`;
  d.innerHTML = `<button class="x" data-act="close" aria-label="Close">✕</button>
<div class="sc">
<div class="dl">
<aside>${posterHtml(movie)}<div class="acts">${tg("watchlist", "＋ Watchlist")}${tg("watched", "✓ Watched")}${tg("favs", "♥ Favourite")}<button class="btn" data-cmp="${escapeHtml(id)}">⇄ Compare</button>
<button class="btn" data-share="${escapeHtml(id)}">↗ Share</button>${movie.source === "tmdb" ? `<button class="btn" data-promote="${escapeHtml(id)}">★ Add to my catalogue</button>` : ""}</div>
</aside>
<div class="body">
 <h1>${escapeHtml(movie.title)}</h1>${movie.original ? `<p class="orig">${escapeHtml(movie.original)}</p>` : ""}<div class="meta">
<span class="badge gold">${movie.year}</span>
<span class="badge">${escapeHtml(movie.category)}</span>
<span class="badge">${escapeHtml(movie.lang)}</span>${movie.imdb ? `<span class="badge gold">IMDb ${movie.imdb}</span>` : ""}${movie.duration ? `<span class="badge">${movie.duration} min</span>` : ""}${movie.genres.map((g) => `<span class="badge">${escapeHtml(g)}</span>`).join("")}</div>
 <p class="syn">${escapeHtml(movie.synopsis)}</p>${
   movie.why
     ? `<p class="why">
<b>Why watch</b>${escapeHtml(movie.why)}</p>`
     : ""
 }${
   movie.director || movie.cast.length
     ? `<dl class="cr">${
         movie.director
           ? `<dt>Director</dt>
<dd>${escapeHtml(movie.director)}</dd>`
           : ""
       }${
         movie.cast.length
           ? `<dt>Cast</dt>
<dd>${escapeHtml(movie.cast.join(", "))}</dd>`
           : ""
       }</dl>`
     : ""
 }
 <section>
<h3>Where to watch in India</h3>
<div class="ottl">${movie.ott.map((o) => ottButtonHtml(movie, o)).join("") || '<span class="mut">No listing yet.</span>'}</div>
</section>
 <section>
<h3>Trailer</h3>
<div id="tr">${
    y
      ? `<button class="thumb" data-trailer="${y}" aria-label="Play trailer" style="background-image:url(https://i.ytimg.com/vi/${y}/hqdefault.jpg)">
<span>▶</span>
</button>`
      : ""
  }<a class="btn" target="_blank" rel="noopener" href="${yurl}">${y ? "Open on YouTube" : "Find trailer on YouTube"}</a>
</div>
</section>
 <section>
<h3>My review</h3>
<div class="f">
<label>Rating<select id="rr">
<option value="">Not rated</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}"${rv.rating == n ? " selected" : ""}>${n} / 5</option>`).join("")}</select>
</label>
<label>Notes<textarea id="rn" rows="3" maxlength="1000" placeholder="What stayed with you?">${escapeHtml(rv.review || "")}</textarea>
</label>
<button class="btn pri" data-saverev="${escapeHtml(id)}">Save review</button>
</div>
</section>
 ${movie.source === "tmdb" ? '<p class="mut attr">Data from TMDB. Streaming availability from JustWatch via TMDB. Not endorsed or certified by TMDB.</p>' : ""}${railHtml("Similar movies", Reco.similar(movie, movies), "")}</div>
</div>
</div>`;
  if (!d.open) d.showModal();
  CineSelect.enhance(d);
  if (!fromHash) history.replaceState(null, "", "#/movie/" + id);
  updateRailArrows();
}
/**
 * Add/Edit movie form (Manage Movies).
 */
function openMovieForm(movie) {
  movie = normalizeMovie(
    movie || {
      id: "",
      title: "",
      year: new Date().getFullYear(),
      lang: "",
      synopsis: "",
      poster: "",
      added: new Date().toISOString().slice(0, 10),
    },
  );
  const T = (
    k,
    l,
    v,
    t = "text",
  ) => `<label>${l}<input name="${k}" type="${t}" value="${escapeHtml(v ?? "")}">
</label>`;
  qs("#dlg").innerHTML = `<button class="x" data-act="close" aria-label="Close">✕</button>
<div class="sc">
<form class="f fm" id="mf" data-orig="${escapeHtml(movie.id)}">
<h1>${movie.id ? "Edit" : "Add"} movie</h1>${T("id", "ID (unique, e.g. name-year)", movie.id)}${T("title", "Title *", movie.title)}${T("original", "Original title", movie.original)}${T("poster", "Poster URL / path *", movie.poster)}${T("backdrop", "Backdrop URL", movie.backdrop)}${T("year", "Year *", movie.year, "number")}${T("imdb", "IMDb", movie.imdb, "number")}${T("lang", "Language *", movie.lang)}<label>Category *<select name="category">${CATEGORIES.map((c) => `<option${movie.category == c ? " selected" : ""}>${c}</option>`).join("")}</select>
</label>${T("genres", "Genres * (comma separated)", movie.genres.join(", "))}${T("duration", "Duration (min)", movie.duration, "number")}${T("country", "Country", movie.country)}${T("director", "Director", movie.director)}${T("cast", "Cast (comma separated)", movie.cast.join(", "))}<label>Synopsis *<textarea name="synopsis" rows="3">${escapeHtml(movie.synopsis)}</textarea>
</label>${T("why", "Why to watch", movie.why)}<label>OTT (one per line: Platform | verified/unverified/unavailable | web URL | app link)<textarea name="ott" rows="3">${escapeHtml(movie.ott.map((o) => [o.p, o.s || "unverified", o.web || "", o.app || ""].join(" | ")).join("\n"))}</textarea>
</label>${T("trailer", "Trailer (YouTube URL/ID)", movie.trailer)}${T("collections", "Collections (comma separated)", movie.collections.join(", "))}${T("similar", "Similar IDs (comma separated)", movie.similar.join(", "))}${T("added", "Date added", movie.added, "date")}
 <label>
<input type="checkbox" name="featured"${movie.featured ? " checked" : ""}> Featured</label>
<label>
<input type="checkbox" name="must"${movie.must ? " checked" : ""}> Must watch</label>
<label>
<input type="checkbox" name="gem"${movie.gem ? " checked" : ""}> Hidden gem</label>
<label>
<input type="checkbox" name="trending"${movie.trending ? " checked" : ""}> Trending</label>
<div id="ferr" style="color:#e66">
</div>
<button class="btn pri" type="submit">Save movie</button>
</form>
</div>`;
  qs("#dlg").showModal();
  CineSelect.enhance(qs("#dlg"));
}
/**
 * Returns a list of human-readable problems: missing fields, duplicate ids, bad category, unknown OTT name.
 * Same rules as tools/check.js.
 */
function validateCatalogue(list) {
  const errors = [],
    ids = new Set();
  list.forEach((movie, i) => {
    const n = movie.title || "#" + (i + 1);
    if (!movie.id) errors.push(n + ": missing id");
    else if (ids.has(movie.id)) errors.push(n + ": duplicate id " + movie.id);
    ids.add(movie.id);
    ["title", "year", "lang", "synopsis", "category"].forEach((k) => {
      if (!movie[k]) errors.push(n + ": missing " + k);
    });
    if (!movie.genres?.length) errors.push(n + ": missing genres");
    if (!movie.ott?.length) errors.push(n + ": missing OTT");
    if (movie.category && !CATEGORIES.includes(movie.category)) errors.push(n + ": invalid category");
    (movie.ott || []).forEach((o) => {
      if (!PLATFORMS[o.p]) errors.push(n + ': unknown OTT "' + o.p + '" (must match a name in PLATFORMS)');
    });
  });
  return errors;
}
/**
 * Save Manage Movies edits in the browser (tied to the current movies.js so edits to the file win).
 */
async function saveCatalogueEdits() {
  usingBrowserEdits = true;
  await Store.set("catalogue", { base: catalogueFingerprint, list: movies });
}
/**
 * Install button (when the browser offers it) or iPhone/Android instructions, shown in Settings.
 */
function renderInstallHint() {
  const s = qs("#inst");
  if (s && window._ip) s.innerHTML = '<button class="btn pri" data-act="install">Install app</button>';
  else if (s) s.textContent = "iPhone: Share → Add to Home Screen. Android/desktop: browser menu → Install.";
}
/**
 * GLOBAL CLICK HANDLER (event delegation).
 * Every button declares what it does with a data-* attribute, e.g. data-open="<id>", data-tg="watchlist",
 * data-act="export". This one listener reads them, so cards re-rendered later keep working.
 */
document.addEventListener("click", async (event) => {
  const clicked = event.target.closest("button,a,[data-open]");
  if (!clicked) return;
  const data = clicked.dataset;
  if (data.open) {
    return openMovieDialog(data.open);
  }
  if (data.tg) {
    const on = toggleInList(data.tg, data.id);
    showToast(on ? "Added" : "Removed");
    clicked.classList.toggle("on", on);
    if (clicked.classList.contains("q")) clicked.textContent = on ? "✓" : "＋";
  } else if (data.cmp) {
    if (!compareList.includes(data.cmp)) {
      compareList.length >= 4 ? showToast("Max 4") : compareList.push(data.cmp);
    }
    showToast("Added to compare");
    updateCompareBar();
  } else if (data.share) {
    const u = location.origin + location.pathname + "#/movie/" + data.share,
      movie = getMovieById(data.share);
    try {
      navigator.share
        ? await navigator.share({ title: movie.title, url: u })
        : (await navigator.clipboard.writeText(u), showToast("Link copied"));
    } catch (x) {}
  } else if (data.app !== undefined && data.web) {
    let gone = false;
    const h = () => {
      if (document.hidden) gone = true;
    };
    document.addEventListener("visibilitychange", h, { once: true });
    if (data.app) location.href = data.app;
    setTimeout(
      () => {
        if (!gone) window.open(data.web, "_blank", "noopener");
      },
      data.app ? 1200 : 0,
    );
  } else if (data.trailer) {
    if (location.protocol === "file:") {
      qs("#tr").innerHTML = `<div class="note">
<span>
<b>Trailer playback needs a local server.</b> YouTube blocks embeds on pages opened from disk. In the project folder run <code>npm start</code>, then open <code>http://localhost:8000</code>. GitHub Pages works too.</span>
<a class="btn" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=${data.trailer}">Watch on YouTube</a>
</div>`;
    } else {
      qs("#tr").innerHTML =
        `<iframe class="vid" src="https://www.youtube-nocookie.com/embed/${data.trailer}?autoplay=1&rel=0&playsinline=1" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay;encrypted-media;fullscreen;picture-in-picture" allowfullscreen title="Trailer">
</iframe>
<p>
<a class="btn" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=${data.trailer}">Not playing? Open on YouTube</a>
</p>`;
    }
  } else if (data.saverev) {
    const r = +qs("#rr").value || 0,
      n = qs("#rn").value.trim();
    userData.reviews[data.saverev] = { rating: r, review: n };
    saveUserData();
    showToast("Review saved");
  } else if (data.genre) {
    filters = { ...DEFAULT_FILTERS, genre: data.genre };
    location.hash = "#/all";
  } else if (data.car) {
    window._cg(+data.car);
  } else if (data.dot) {
    window._cd(+data.dot);
  } else if (data.rail) {
    const r = clicked.parentElement.querySelector(".rail");
    r.scrollBy({ left: +data.rail * r.clientWidth * 0.85, behavior: "smooth" });
  } else if (data.promote) {
    await promoteToCatalogue(data.promote);
  } else if (data.ott) {
    filters.ott = filters.ott === data.ott ? "" : data.ott;
    renderRoute();
  } else if (data.edit) openMovieForm(getMovieById(data.edit));
  else if (data.del) {
    if (confirm("Delete this movie from your catalogue?")) {
      movies = movies.filter((movie) => movie.id !== data.del);
      await saveCatalogueEdits();
      renderRoute();
    }
  } else
    switch (data.act) {
      case "close":
        qs("#dlg").close();
        break;
      case "clear":
        filters = { ...DEFAULT_FILTERS };
        renderRoute();
        break;
      case "random":
        {
          const movie = movies[(Math.random() * movies.length) | 0];
          movie && openMovieDialog(movie.id);
        }
        break;
      case "clearhist":
        userData.history = [];
        saveUserData();
        renderRoute();
        break;
      case "cmpclear":
        compareList = [];
        renderRoute();
        break;
      case "export":
        downloadFile(
          "cinevault-backup.json",
          JSON.stringify(
            {
              app: "cinevault",
              v: 1,
              date: new Date().toISOString(),
              data: {
                watchlist: userData.watchlist,
                watched: userData.watched,
                favs: userData.favs,
                reviews: userData.reviews,
                history: userData.history,
              },
            },
            null,
            2,
          ),
        );
        break;
      case "wipe":
        if (confirm("Erase watchlist, reviews and history? Export a backup first.")) {
          userData = { watchlist: [], watched: [], favs: [], reviews: {}, history: [] };
          await saveUserData();
          showToast("Erased");
          renderRoute();
        }
        break;
      case "newm":
        openMovieForm();
        break;
      case "expjson":
        downloadFile("movies.json", JSON.stringify(movies, null, 2));
        break;
      case "expjs":
        downloadFile(
          "movies.js",
          "window.MOVIES = " + JSON.stringify(movies, null, 2) + ";\n",
          "text/javascript",
        );
        break;
      case "validate":
        {
          const errors = validateCatalogue(movies);
          qs("#vres").innerHTML = errors.length
            ? "<ul>" + errors.map((x) => `<li>${escapeHtml(x)}</li>`).join("") + "</ul>"
            : '<p class="badge ok">All entries valid.</p>';
        }
        break;
      case "resetcat":
        if (confirm("Discard browser edits and use movies.js?")) {
          await Store.remove("catalogue");
          usingBrowserEdits = false;
          movies = MOVIES.map(normalizeMovie);
          catalogueIssues = validateCatalogue(movies);
          renderRoute();
        }
        break;
      case "savekey":
        {
          const v = qs("#tk").value.trim();
          Store.setPref("tmdbKey", v);
          showToast(v ? "Key saved" : "Key removed");
        }
        break;
      case "clearkey":
        Store.setPref("tmdbKey", "");
        qs("#tk").value = "";
        showToast("Key removed");
        break;
      case "install":
        window._ip.prompt();
        break;
    }
});
/**
 * Add/Edit movie form submit: parse fields → validate → save to browser → re-render.
 */
document.addEventListener("submit", async (event) => {
  if (event.target.id !== "mf") return;
  event.preventDefault();
  const f = new FormData(event.target),
    g = (k) => (f.get(k) || "").toString().trim(),
    L = (k) =>
      g(k)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  const movie = normalizeMovie({
    id: g("id"),
    title: g("title"),
    original: g("original"),
    poster: g("poster"),
    backdrop: g("backdrop"),
    year: +g("year") || 0,
    imdb: g("imdb") ? +g("imdb") : null,
    lang: g("lang"),
    category: g("category"),
    genres: L("genres"),
    duration: +g("duration") || null,
    country: g("country"),
    director: g("director"),
    cast: L("cast"),
    synopsis: g("synopsis"),
    why: g("why"),
    trailer: g("trailer"),
    collections: L("collections"),
    similar: L("similar"),
    added: g("added"),
    featured: !!f.get("featured"),
    must: !!f.get("must"),
    gem: !!f.get("gem"),
    trending: !!f.get("trending"),
    ott: g("ott")
      .split("\n")
      .map((l) => l.split("|").map((s) => s.trim()))
      .filter((a) => a[0])
      .map((a) => ({
        p: a[0],
        s: ["verified", "unverified", "unavailable"].includes(a[1]) ? a[1] : "unverified",
        web: a[2] || "",
        app: a[3] || "",
      })),
  });
  const o = event.target.dataset.orig,
    rest = movies.filter((x) => x.id !== o),
    err = validateCatalogue([...rest, movie]).filter((x) => x.includes(movie.title || "#"));
  if (!/^[\w-]+$/.test(movie.id)) err.unshift("ID may contain letters, numbers, - and _ only");
  if (err.length) {
    qs("#ferr").textContent = err.join(". ");
    return;
  }
  movies = [...rest, movie];
  await saveCatalogueEdits();
  qs("#dlg").close();
  showToast("Saved");
  renderRoute();
});
/**
 * Live updates: filters on All Movies and the Manage Movies search box. (Custom dropdowns fire "input" too.)
 */
document.addEventListener("input", (event) => {
  if (event.target.id === "mq") {
    window._mq = event.target.value;
    qs(".mlist").innerHTML = manageRowsHtml(window._mq);
    return;
  }
  const k = event.target.dataset.f;
  if (k) {
    filters[k] = event.target.value;
    renderResults();
  }
  if (event.target.id === "oled") {
    Store.setPref("oled", event.target.checked);
    document.body.style.background = event.target.checked ? "#000" : "";
  }
});
/**
 * Backup import: validates the JSON file before restoring anything.
 */
document.addEventListener("change", (event) => {
  if (event.target.id !== "imp") return;
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 5e6) return showToast("File too large");
  const r = new FileReader();
  r.onload = async () => {
    try {
      const j = JSON.parse(r.result);
      if (j.app !== "cinevault" || typeof j.data !== "object") throw 0;
      const d = j.data,
        ok = (a) => Array.isArray(a) && a.every((x) => typeof x === "string");
      if (![d.watchlist, d.watched, d.favs, d.history].every(ok)) throw 0;
      const rv = {};
      Object.entries(d.reviews || {}).forEach(([k, v]) => {
        if (v && typeof v === "object")
          rv[k] = {
            rating: Math.min(5, Math.max(0, +v.rating || 0)),
            review: String(v.review || "").slice(0, 1000),
          };
      });
      userData = {
        watchlist: d.watchlist,
        watched: d.watched,
        favs: d.favs,
        history: d.history,
        reviews: rv,
      };
      await saveUserData();
      showToast("Backup restored");
      renderRoute();
    } catch (x) {
      showToast("Invalid backup file");
    }
  };
  r.readAsText(file);
});
qs("#gsearch").addEventListener("input", (event) => {
  filters = { ...DEFAULT_FILTERS, q: event.target.value };
  if (location.hash !== "#/all") location.hash = "#/all";
  else renderRoute();
});
const toggleDrawer = () => {
  const o = qs("#nav").classList.toggle("open");
  qs("#menuBtn").setAttribute("aria-expanded", o);
};
qs("#menuBtn").onclick = toggleDrawer;
qs("#moreBtn").onclick = toggleDrawer;
qs("#scrim").onclick = () => qs("#nav").classList.remove("open");
qs("#cmpBar").onclick = () => (location.hash = "#/compare");
qs("#dlg").addEventListener("close", () => {
  qs("#dlg").innerHTML = "";
  if (location.hash.startsWith("#/movie/")) history.replaceState(null, "", "#/" + (window._last || "home"));
});
/**
 * Keyboard shortcuts: / search · r random · h home · a all · w watchlist · s stats · m manage.
 */
document.addEventListener("keydown", (event) => {
  if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.metaKey || event.ctrlKey) return;
  const k = event.key,
    go = { h: "home", a: "all", w: "watchlist", m: "manage", s: "stats" };
  if (k === "/") {
    event.preventDefault();
    qs("#gsearch").focus();
  } else if (k === "r")
    (views && document.querySelector("[data-act=random]")?.click()) ||
      (() => {
        const movie = movies[(Math.random() * movies.length) | 0];
        movie && openMovieDialog(movie.id);
      })();
  else if (go[k]) location.hash = "#/" + go[k];
});
const updateNetworkBadge = () => {
  const n = qs("#net");
  n.textContent = navigator.onLine ? "Online" : "Offline";
  n.classList.toggle("off", !navigator.onLine);
};
addEventListener("online", updateNetworkBadge);
addEventListener("offline", updateNetworkBadge);
addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  window._ip = event;
  renderInstallHint();
});
addEventListener("hashchange", renderRoute);
/**
 * BOOT: build the sidebar → open IndexedDB → load user data and catalogue → validate → render → register the service worker.
 */
(async () => {
  qs("#nav").innerHTML = NAV_ITEMS.map(
    ([k, l]) => `<a href="#/${k}" data-k="${k}">
<i aria-hidden="true">${NAV_ICONS[k]}</i>${l}</a>`,
  ).join("");
  updateNetworkBadge();
  await Store.open();
  for (const k of Object.keys(userData)) userData[k] = await Store.get(k, userData[k]);
  savedExternalMovies = await Store.get("ext", {});
  catalogueFingerprint =
    (window.MOVIES || []).map((movie) => movie.id).join() + JSON.stringify(window.MOVIES || []).length;
  const cat = await Store.get("catalogue", null);
  usingBrowserEdits = !!(
    cat &&
    cat.base === catalogueFingerprint &&
    Array.isArray(cat.list) &&
    cat.list.length
  );
  movies = (usingBrowserEdits ? cat.list : window.MOVIES || []).map(normalizeMovie);
  catalogueIssues = validateCatalogue(movies);
  if (catalogueIssues.length) console.warn("CineVault catalogue issues:", catalogueIssues);
  if (Store.pref("oled")) document.body.style.background = "#000";
  renderRoute();
  if ("serviceWorker" in navigator)
    navigator.serviceWorker
      .register("service-worker.js")
      .then((r) => {
        r.addEventListener("updatefound", () => {
          const w = r.installing;
          w.addEventListener("statechange", () => {
            if (w.state === "installed" && navigator.serviceWorker.controller) {
              showToast("Update ready — reloading");
              w.postMessage("skip");
              setTimeout(() => location.reload(), 1200);
            }
          });
        });
      })
      .catch(() => {});
})();

/**
 * Copy a TMDB movie into your own catalogue (OTT statuses reset to "unverified"). Export from Manage Movies to keep it.
 */
async function promoteToCatalogue(id) {
  const movie = getMovieById(id);
  if (!movie) return;
  const slug =
    movie.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") +
    "-" +
    movie.year;
  if (movies.some((x) => x.id === slug)) return showToast("Already in your catalogue");
  const c = {
    ...movie,
    id: slug,
    ott: (movie.ott || []).map((o) => ({ ...o, s: "unverified" })),
    added: new Date().toISOString().slice(0, 10),
  };
  ["source", "tid", "_full", "_try"].forEach((k) => delete c[k]);
  movies.push(normalizeMovie(c));
  await saveCatalogueEdits();
  showToast("Added. Export from Manage Movies to keep it in movies.js.");
}
