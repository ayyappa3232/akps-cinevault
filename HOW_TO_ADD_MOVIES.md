# How to add movies (one file: movies.js)

1. Open `movies.js`. Scroll to the bottom, to the line `>>> ADD NEW MOVIES ABOVE THIS LINE <<<`.
2. Copy this block and paste it just above that line:
```js
{id:"title-year", title:"Title", year:2020, lang:"English", category:"Hollywood", genres:["Drama"],
 synopsis:"One or two sentences.", ott:[{p:"Netflix", s:"unverified"}],
 imdb:8.0, duration:120, country:"USA", director:"Name", cast:["A","B"], why:"Why it is worth watching.",
 trailer:"YOUTUBE_ID", must:true, gem:false, trending:false, featured:false, collections:[], similar:[]},
```
3. Make `id` unique, lowercase, hyphenated (`the-lunchbox-2013`).
4. Pick `category` from: Indian, Hollywood, Korean, International, Japanese, Documentaries, Animation.
5. OTT names must match exactly: Netflix, Amazon Prime Video, JioHotstar, ZEE5, Sony LIV, Aha, Sun NXT, Apple TV+, Lionsgate Play, Hoichoi, ManoramaMAX. Use `s:"verified"` only after checking in India. Add `web:"https://…"` for an exact movie page.
6. Poster: save `assets/posters/<id>.jpg` (2:3, ~400×600). Skip it and a styled cover is generated.
7. Save → refresh. Banners show problems. Or run `node tools/check.js`.
8. Deploy: bump `V` in `service-worker.js` (cinevault-v3…), commit, push.

Tips: `must:true` → Must Watch, `gem:true` → Hidden Gems, `trending:true` → Trending, `collections:["Mind-benders"]` → Collections, `similar:["other-id"]` → Similar.
