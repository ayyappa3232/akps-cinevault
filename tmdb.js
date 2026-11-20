/**
 * tmdb.js — optional live discovery (see README → Discover). Loaded before app.js; uses app.js
 * helpers (qs, escapeHtml, movieCardHtml, normalizeMovie, …) at call time, so load order is safe.
 */
/* Optional live discovery via TMDB (free key from themoviedb.org). Key is entered by you and kept in this browser only. */
/**
 * TMDB helper (optional "Discover" feature).
 * The key is entered by YOU in Settings or on the Discover page and kept only in this browser — never commit a key.
 * Docs: https://developer.themoviedb.org/docs
 */
const Tmdb = {
  /**
   * Base URL for images. Append a size and the poster_path, e.g. IMG + "w500" + path.
   */
  IMG: "https://image.tmdb.org/t/p/",
  /**
   * The saved key (v3 API key or v4 read-access token).
   */
  key: () => (Store.pref("tmdbKey", "") || "").trim(),
  /**
   * True when a key has been saved.
   */
  ready() {
    return !!this.key();
  },
  /**
   * ISO language code → display name (filters and cards).
   */
  LANGUAGES: {
    en: "English",
    hi: "Hindi",
    te: "Telugu",
    ta: "Tamil",
    ml: "Malayalam",
    kn: "Kannada",
    bn: "Bengali",
    mr: "Marathi",
    pa: "Punjabi",
    ko: "Korean",
    ja: "Japanese",
    fr: "French",
    es: "Spanish",
    de: "German",
    it: "Italian",
    zh: "Chinese",
    th: "Thai",
    ru: "Russian",
    pt: "Portuguese",
    tr: "Turkish",
    fa: "Persian",
    ar: "Arabic",
  },
  /**
   * Languages that map to the "Indian" category.
   */
  INDIAN_LANGUAGES: ["hi", "te", "ta", "ml", "kn", "bn", "mr", "pa"],
  /**
   * Our platform name → TMDB watch-provider id (India). Powers the "Streaming in India" filter.
   */
  PROVIDER_IDS: {
    Netflix: 8,
    "Amazon Prime Video": 119,
    JioHotstar: 122,
    ZEE5: 232,
    "Sony LIV": 237,
    Aha: 532,
    "Sun NXT": 309,
    "Apple TV+": 350,
  },
  /**
   * GET helper. Adds the key (v3 as ?api_key=, v4 as Bearer token). Throws "BADKEY" on 401, "NOKEY" if missing.
   */
  async request(path, q = {}) {
    const k = this.key();
    if (!k) throw new Error("NOKEY");
    const u = new URL("https://api.themoviedb.org/3" + path),
      h = {};
    Object.entries(q).forEach(([a, b]) => {
      if (b !== "" && b != null) u.searchParams.set(a, b);
    });
    if (k.length > 40) h.Authorization = "Bearer " + k;
    else u.searchParams.set("api_key", k);
    const r = await fetch(u, { headers: h });
    if (r.status === 401) throw new Error("BADKEY");
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  },
  /**
   * Genre id → name map. Fetched once, then cached.
   */
  async genres() {
    if (!this.genreCache) {
      const r = await this.request("/genre/movie/list");
      this.genreCache = Object.fromEntries(r.genres.map((x) => [x.id, x.name]));
    }
    return this.genreCache;
  },
  /**
   * Map TMDB language + genres onto our 7 categories.
   */
  categoryFor(l, g) {
    return g.includes("Documentary")
      ? "Documentaries"
      : g.includes("Animation")
        ? "Animation"
        : this.INDIAN_LANGUAGES.includes(l)
          ? "Indian"
          : l === "en"
            ? "Hollywood"
            : l === "ko"
              ? "Korean"
              : l === "ja"
                ? "Japanese"
                : "International";
  },
  /**
   * Convert a TMDB result into the CineVault movie shape (see the header of movies.js).
   */
  toMovie(x, g) {
    const gn = (
        x.genres ? x.genres.map((a) => a.name) : (x.genre_ids || []).map((i) => g[i]).filter(Boolean)
      ).map((n) => (n === "Science Fiction" ? "Sci-Fi" : n)),
      l = x.original_language;
    return {
      id: "tmdb-" + x.id,
      source: "tmdb",
      tid: x.id,
      title: x.title,
      original: x.original_title && x.original_title !== x.title ? x.original_title : "",
      poster: x.poster_path ? this.IMG + "w500" + x.poster_path : "",
      backdrop: x.backdrop_path ? this.IMG + "w1280" + x.backdrop_path : "",
      year: +(x.release_date || "").slice(0, 4) || 0,
      tmdb: x.vote_average || null,
      lang: this.LANGUAGES[l] || (l || "").toUpperCase(),
      genres: gn,
      synopsis: x.overview || "No synopsis available.",
      category: this.categoryFor(l, gn),
      ott: [],
      added: new Date().toISOString().slice(0, 10),
    };
  },
  /**
   * One page of search results or a filtered "discover" list. Returns { total, items }.
   */
  async fetchList(o, page) {
    const g = await this.genres();
    let r;
    if (o.q) r = await this.request("/search/movie", { query: o.q, page, include_adult: "false" });
    else {
      const top = o.mode === "top";
      r = await this.request("/discover/movie", {
        sort_by: top ? "vote_average.desc" : "popularity.desc",
        "vote_count.gte": top ? (this.INDIAN_LANGUAGES.includes(o.lang) ? 300 : 1500) : 50,
        with_original_language: o.lang,
        with_genres: o.genre,
        "primary_release_date.gte": o.year ? o.year + "-01-01" : "",
        "vote_average.gte": o.min,
        with_watch_providers: o.prov ? this.PROVIDER_IDS[o.prov] : "",
        watch_region: o.prov ? "IN" : "",
        with_watch_monetization_types: o.prov ? "flatrate" : "",
        include_adult: "false",
        page,
      });
    }
    return { total: r.total_pages || 1, items: r.results.map((x) => normalizeMovie(this.toMovie(x, g))) };
  },
  /**
   * Normalise TMDB provider names ("Disney Plus Hotstar") to our PLATFORMS keys.
   */
  platformName(n) {
    const s = n.toLowerCase();
    return s.includes("netflix")
      ? "Netflix"
      : s.includes("amazon") || s.includes("prime")
        ? "Amazon Prime Video"
        : s.includes("hotstar")
          ? "JioHotstar"
          : s.includes("zee")
            ? "ZEE5"
            : s.includes("sony")
              ? "Sony LIV"
              : /^aha/.test(s)
                ? "Aha"
                : s.includes("sun nxt")
                  ? "Sun NXT"
                  : s.includes("apple tv")
                    ? "Apple TV+"
                    : s.includes("lionsgate")
                      ? "Lionsgate Play"
                      : s.includes("hoichoi")
                        ? "Hoichoi"
                        : s.includes("manorama")
                          ? "ManoramaMAX"
                          : n;
  },
  /**
   * Load runtime, director, cast, trailer and India streaming providers into a movie (fetched once).
   */
  async detail(movie) {
    const x = await this.request("/movie/" + movie.tid, {
        append_to_response: "credits,videos,watch/providers",
      }),
      cr = x.credits || {};
    movie.duration = x.runtime || null;
    movie.country = ((x.production_countries || [])[0] || {}).name || "";
    movie.director = ((cr.crew || []).find((c) => c.job === "Director") || {}).name || "";
    movie.cast = (cr.cast || []).slice(0, 5).map((c) => c.name);
    if (x.genres && x.genres.length)
      movie.genres = x.genres.map((a) => (a.name === "Science Fiction" ? "Sci-Fi" : a.name));
    const v = ((x.videos || {}).results || []).filter((a) => a.site === "YouTube"),
      t = v.find((a) => a.type === "Trailer" && a.official) || v.find((a) => a.type === "Trailer") || v[0];
    movie.trailer = t ? t.key : "";
    const pr = ((x["watch/providers"] || {}).results || {}).IN || {},
      seen = {};
    movie.ott = (pr.flatrate || [])
      .map((p) => this.platformName(p.provider_name))
      .filter((n) => !seen[n] && (seen[n] = 1))
      .map((n) => ({ p: n, s: "live", web: PLATFORMS[n] ? "" : pr.link || "" }));
    movie._full = true;
  },
};
/**
 * Paging state for the Discover list.
 */
let discoverState = { page: 0, tot: 1, items: [] };
/**
 * Builds a labelled <select> from [value, label] pairs.
 */
const selectHtml = (id, l, a) => `<label class="sel">
<span>${l}</span>
<select id="${id}">${a.map(([v, t]) => `<option value="${v}">${escapeHtml(t)}</option>`).join("")}</select>
</label>`;
/**
 * Discover page: key setup panel when no key is saved, otherwise the filter panel and results area.
 */
function discoverView() {
  if (!Tmdb.ready())
    return `<h1>Discover</h1>
<div class="panel">
<h2>Browse beyond your curated list</h2>
<p>Free API, 2 minutes:</p>
<ol>
<li>Create a free account at themoviedb.org.</li>
<li>Open Settings, then API, and request a Developer key.</li>
<li>Paste it here. It stays in this browser only.</li>
</ol>
<div class="f">
<input id="tk2" type="password" autocomplete="off" placeholder="TMDB API key or read access token">
<button class="btn pri" data-dact="key">Save and browse</button>
</div>
</div>`;
  return `<h1>Discover</h1>
<p class="mut">Live results from TMDB. Movies already in your list are marked <span class="src cur">Curated</span>; everything else is <span class="src ext">TMDB</span>.</p>
 <div class="filters">
<input id="dq" type="search" placeholder="Search any movie…" aria-label="Search TMDB">
<div class="fg">${selectHtml("dmode", "Show", [
    ["top", "Top rated"],
    ["pop", "Popular"],
  ])}${selectHtml("dlang", "Language", [["", "Any"], ...Object.entries(Tmdb.LANGUAGES).map(([c, n]) => [c, n])])}<label class="sel">
<span>Genre</span>
<select id="dgenre">
<option value="">Any</option>
</select>
</label>${selectHtml("dyear", "Released from", [
    ["", "Any"],
    ["2020", "2020"],
    ["2010", "2010"],
    ["2000", "2000"],
    ["1990", "1990"],
    ["1970", "1970"],
  ])}${selectHtml("dmin", "TMDB rating", [
    ["", "Any"],
    ["8", "8+"],
    ["7.5", "7.5+"],
    ["7", "7+"],
    ["6", "6+"],
  ])}${selectHtml("dprov", "Streaming in India", [["", "Any"], ...Object.keys(Tmdb.PROVIDER_IDS).map((n) => [n, n])])}</div>
<div class="row">
<button class="btn pri" data-dact="go">Search</button>
<button class="btn" data-dact="reset">Reset</button>
</div>
</div>
 <div id="dres">
</div>
<p class="mut attr">This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming availability data by JustWatch.</p>`;
}
/**
 * Fill the genre dropdown from TMDB, then load the first page.
 */
async function initDiscover() {
  if (!Tmdb.ready()) return;
  try {
    const g = await Tmdb.genres();
    qs("#dgenre").innerHTML =
      '<option value="">Any</option>' +
      Object.entries(g)
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([i, n]) => `<option value="${i}">${escapeHtml(n)}</option>`)
        .join("");
    CineSelect.sync(qs("#dgenre"));
  } catch (error) {
    return showDiscoverError(error);
  }
  loadDiscoverPage();
}
/**
 * Friendly message for bad key / offline / API error.
 */
function showDiscoverError(error) {
  const movie =
    error.message === "BADKEY"
      ? "TMDB rejected your key. Update it in Settings."
      : error instanceof TypeError
        ? "Could not reach TMDB. Check your connection."
        : "TMDB returned an error (" + escapeHtml(error.message) + "). Try again.";
  const r = qs("#dres");
  if (r) r.innerHTML = `<div class="empty">${movie}</div>`;
}
/**
 * Run the current filters. Movies already in your catalogue are shown as "Curated"; the rest are tagged TMDB.
 */
async function loadDiscoverPage(more) {
  const o = {
      q: qs("#dq").value.trim(),
      mode: qs("#dmode").value,
      lang: qs("#dlang").value,
      genre: qs("#dgenre").value,
      year: qs("#dyear").value,
      min: qs("#dmin").value,
      prov: qs("#dprov").value,
    },
    r = qs("#dres");
  if (!more) {
    discoverState = { page: 0, tot: 1, items: [] };
    r.innerHTML = '<div class="empty">Loading…</div>';
  }
  try {
    const x = await Tmdb.fetchList(o, discoverState.page + 1);
    discoverState.page++;
    discoverState.tot = x.total;
    const cur = new Map(movies.map((movie) => [movie.title.toLowerCase() + movie.year, movie])),
      ids = new Set(discoverState.items.map((movie) => movie.id));
    x.items.forEach((movie) => {
      const c = cur.get(movie.title.toLowerCase() + movie.year),
        u = c || movie;
      if (!c) discoverCache[movie.id] = movie;
      if (!ids.has(u.id)) {
        ids.add(u.id);
        discoverState.items.push(u);
      }
    });
    r.innerHTML = discoverState.items.length
      ? `<div class="grid">${discoverState.items.map(movieCardHtml).join("")}</div>${discoverState.page < discoverState.tot ? '<p class="more"><button class="btn" data-dact="more">Load more</button></p>' : ""}`
      : '<div class="empty">No results. Try different filters.</div>';
  } catch (error) {
    showDiscoverError(error);
  }
}
document.addEventListener("click", (event) => {
  const b = event.target.closest("[data-dact]");
  if (!b) return;
  const a = b.dataset.dact;
  if (a === "key") {
    const v = qs("#tk2").value.trim();
    if (v.length < 20) return showToast("That key looks too short");
    Store.setPref("tmdbKey", v);
    renderRoute();
  } else if (a === "go") loadDiscoverPage();
  else if (a === "more") loadDiscoverPage(true);
  else if (a === "reset") renderRoute();
});
document.addEventListener("keydown", (event) => {
  if (event.target.id === "dq" && event.key === "Enter") loadDiscoverPage();
});
document.addEventListener("change", (event) => {
  if (event.target.closest(".filters") && /^d(mode|lang|genre|year|min|prov)$/.test(event.target.id))
    loadDiscoverPage();
});
