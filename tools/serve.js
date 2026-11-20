// Zero-dependency static server: npm start  →  http://localhost:8000
const http = require("http"),
  fs = require("fs"),
  path = require("path"),
  root = path.join(__dirname, ".."),
  T = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  };
http
  .createServer((q, r) => {
    let p = decodeURIComponent(q.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(root, p);
    if (!f.startsWith(root)) {
      r.writeHead(403);
      return r.end();
    }
    fs.readFile(f, (e, d) => {
      if (e) {
        r.writeHead(404);
        return r.end("Not found");
      }
      r.writeHead(200, {
        "Content-Type": T[path.extname(f)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      r.end(d);
    });
  })
  .listen(8000, () => console.log("CineVault → http://localhost:8000"));
