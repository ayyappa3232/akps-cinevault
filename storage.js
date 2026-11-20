/**
 * storage.js — all browser persistence lives here.
 *
 *   IndexedDB    → larger user data: watchlist, watched, favourites, reviews, history,
 *                  saved TMDB movies, and catalogue edits made in "Manage Movies".
 *   localStorage → tiny preferences: theme toggle, TMDB API key.
 *
 * If IndexedDB is unavailable (private mode, old browser) we silently fall back
 * to localStorage so the app keeps working.
 */
const Store = {
  db: null,

  /** Open (and create on first run) the IndexedDB database. Always resolves. */
  open() {
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open("cinevault", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("kv"); // simple key/value store
        request.onsuccess = () => {
          this.db = request.result;
          resolve();
        };
        request.onerror = () => resolve();
      } catch (error) {
        resolve();
      }
    });
  },

  /** Read a value by key. Returns `fallback` when missing. */
  get(key, fallback) {
    return new Promise((resolve) => {
      if (!this.db) {
        const stored = JSON.parse(localStorage.getItem("cv_" + key) || "null");
        return resolve(stored ?? fallback);
      }
      const request = this.db.transaction("kv").objectStore("kv").get(key);
      request.onsuccess = () => resolve(request.result ?? fallback);
      request.onerror = () => resolve(fallback);
    });
  },

  /** Write a value by key. */
  set(key, value) {
    return new Promise((resolve) => {
      if (!this.db) {
        try {
          localStorage.setItem("cv_" + key, JSON.stringify(value));
        } catch (error) {
          /* storage full or blocked: ignore */
        }
        return resolve();
      }
      const transaction = this.db.transaction("kv", "readwrite");
      transaction.objectStore("kv").put(value, key);
      transaction.oncomplete = resolve;
      transaction.onerror = resolve;
    });
  },

  /** Delete a key. */
  remove(key) {
    return new Promise((resolve) => {
      if (!this.db) {
        localStorage.removeItem("cv_" + key);
        return resolve();
      }
      const transaction = this.db.transaction("kv", "readwrite");
      transaction.objectStore("kv").delete(key);
      transaction.oncomplete = resolve;
    });
  },

  /** Synchronous preference read (localStorage). */
  pref(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem("cvp_" + key)) ?? fallback;
    } catch (error) {
      return fallback;
    }
  },

  /** Synchronous preference write (localStorage). */
  setPref(key, value) {
    try {
      localStorage.setItem("cvp_" + key, JSON.stringify(value));
    } catch (error) {
      /* ignore */
    }
  },
};
