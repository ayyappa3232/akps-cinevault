// Usage: node tools/check.js  — validates movies.js and reports missing poster files
const fs = require("fs"),
  vm = require("vm"),
  path = require("path"),
  root = path.join(__dirname, "..");
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "movies.js"), "utf8"), ctx);
const { MOVIES: M, PLATFORMS: P } = ctx.window,
  CATS = ["Indian", "Hollywood", "Korean", "International", "Japanese", "Documentaries", "Animation"];
let bad = 0;
const seen = new Set();
M.forEach((m, i) => {
  const n = m.title || "#" + (i + 1),
    err = (t) => {
      bad++;
      console.log("✗", n + ":", t);
    };
  if (!m.id) err("missing id");
  else {
    if (seen.has(m.id)) err("duplicate id " + m.id);
    seen.add(m.id);
    if (!/^[\w-]+$/.test(m.id)) err("id may only use letters, numbers, - and _");
  }
  ["title", "year", "lang", "synopsis", "category"].forEach((k) => m[k] || err("missing " + k));
  (m.genres || []).length || err("missing genres");
  (m.ott || []).length || err("missing ott");
  CATS.includes(m.category) || err("invalid category");
  (m.ott || []).forEach((o) => P[o.p] || err('unknown OTT "' + o.p + '"'));
  const poster = m.poster || `assets/posters/${m.id}.jpg`;
  if (!/^https?:/.test(poster) && !fs.existsSync(path.join(root, poster)))
    console.log("! poster file missing for", n, "->", poster);
});
console.log(`\n${M.length} movies, ${bad} problem(s).`);
process.exit(bad ? 1 : 0);
