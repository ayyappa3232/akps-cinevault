/**
 * recommendations.js — small scoring helpers. Pure functions, no DOM access.
 */
const Reco = {
  /**
   * Movies similar to `movie`, best first.
   * Score: hand-picked `similar` ids (+10), shared genres (+2 each),
   * same language (+2), same category (+1), same director (+3).
   */
  similar(movie, movies, limit = 6) {
    const handPicked = new Set(movie.similar || []);
    return movies
      .filter((other) => other.id !== movie.id)
      .map((other) => {
        let score = 0;
        if (handPicked.has(other.id)) score += 10;
        score += other.genres.filter((genre) => movie.genres.includes(genre)).length * 2;
        if (other.lang === movie.lang) score += 2;
        if (other.category === movie.category) score += 1;
        if (other.director && other.director === movie.director) score += 3;
        return { other, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => entry.other);
  },

  /**
   * "Picked for you": learn taste from watched + favourite movies (weighted by your
   * 1–5 rating, default 7/10), then rank everything you haven't watched or queued.
   */
  forYou(movies, userData, limit = 8) {
    const alreadyKnown = new Set([...userData.watched, ...userData.watchlist]);
    const taste = {}; // e.g. { "gDrama": 1.4, "lHindi": 0.8, "cIndian": 1.0 }
    const bump = (key, amount) => (taste[key] = (taste[key] || 0) + amount);

    userData.watched.concat(userData.favs).forEach((id) => {
      const movie = movies.find((candidate) => candidate.id === id);
      if (!movie) return;
      const weight = (userData.reviews[id]?.rating || 7) / 5;
      movie.genres.forEach((genre) => bump("g" + genre, weight));
      bump("l" + movie.lang, weight);
      bump("c" + movie.category, weight);
    });

    return movies
      .filter((movie) => !alreadyKnown.has(movie.id))
      .map((movie) => {
        const genreScore = movie.genres.reduce((sum, genre) => sum + (taste["g" + genre] || 0), 0);
        const score =
          genreScore +
          (taste["l" + movie.lang] || 0) +
          (taste["c" + movie.category] || 0) +
          (movie.imdb || 0) / 10;
        return { movie, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => entry.movie);
  },

  /** Deterministic "Movie of the day": same movie all day, changes at midnight. */
  daily(movies) {
    const today = new Date();
    const dayNumber = today.getFullYear() * 372 + today.getMonth() * 31 + today.getDate();
    return movies[dayNumber % movies.length];
  },
};
