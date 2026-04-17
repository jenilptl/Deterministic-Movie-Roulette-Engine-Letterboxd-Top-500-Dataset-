import "dotenv/config";
import express from "express";
import cors from "cors";
import { loadMovies } from "./movieStore.js";
import { URL } from "node:url";
import { getUserState, isValidRating, recordSpin, updateMovieState } from "./userStore.js";

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/movies", async (_req, res) => {
  try {
    const movies = await loadMovies();
    const state = await getUserState();
    const merged = movies.map((movie) => {
      const user = state.bySlug[movie.slug] || {};
      return {
        ...movie,
        watched: Boolean(user.watched),
        userRating: typeof user.userRating === "number" ? user.userRating : null,
      };
    });
    res.json({ count: merged.length, movies: merged });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/history", async (req, res) => {
  try {
    const state = await getUserState();
    const q = String(req.query.q || "").trim().toLowerCase();
    const history = q
      ? state.history.filter((h) => h.title.toLowerCase().includes(q))
      : state.history;
    res.json({ count: history.length, history });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/spins", async (req, res) => {
  try {
    const { slug } = req.body || {};
    if (!slug) return res.status(400).json({ error: "Missing slug." });
    const movies = await loadMovies();
    const movie = movies.find((m) => m.slug === slug);
    if (!movie) return res.status(404).json({ error: "Movie not found." });
    const history = await recordSpin(movie);
    res.json({ ok: true, history });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch("/api/movie/:slug", async (req, res) => {
  try {
    const slug = req.params.slug;
    const { watched, userRating } = req.body || {};
    if (typeof watched !== "boolean" && !Object.hasOwn(req.body || {}, "userRating")) {
      return res.status(400).json({ error: "Nothing to update." });
    }
    if (Object.hasOwn(req.body || {}, "userRating") && !isValidRating(userRating)) {
      return res.status(400).json({ error: "Rating must be 0..5 in 0.5 steps or null." });
    }
    const updated = await updateMovieState(slug, { watched, userRating });
    res.json({ ok: true, state: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/poster", async (req, res) => {
  try {
    const raw = req.query.url;
    if (typeof raw !== "string" || !raw) {
      return res.status(400).json({ error: "Missing poster url query param." });
    }

    const decoded = decodeURIComponent(raw);
    const parsed = new URL(decoded);
    const host = parsed.hostname.toLowerCase();
    const allowlisted =
      host.endsWith("ltrbxd.com") ||
      host.endsWith("imdb.com") ||
      host.endsWith("media-amazon.com") ||
      host.endsWith("amazonaws.com");
    if (!allowlisted) {
      return res.status(400).json({ error: "Poster host not allowed." });
    }

    const upstream = await fetch(decoded, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://letterboxd.com/",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
    if (!upstream.ok) {
      return res.status(502).json({ error: `Poster fetch failed: ${upstream.status}` });
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    const cacheControl = upstream.headers.get("cache-control") || "public, max-age=86400";
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", cacheControl);
    res.send(buf);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/poster/imdb/:imdbId", async (req, res) => {
  try {
    const imdbId = req.params.imdbId;
    if (!/^tt\d+$/.test(imdbId)) {
      return res.status(400).json({ error: "Invalid IMDb id." });
    }

    const imdbPage = await fetch(`https://www.imdb.com/title/${imdbId}/`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!imdbPage.ok) {
      return res.status(502).json({ error: `IMDb page fetch failed: ${imdbPage.status}` });
    }
    const html = await imdbPage.text();
    const imageUrl =
      html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)?.[1] || null;
    if (!imageUrl) {
      return res.status(404).json({ error: "Poster not found on IMDb page." });
    }

    const img = await fetch(imageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: `https://www.imdb.com/title/${imdbId}/`,
      },
    });
    if (!img.ok) {
      return res.status(502).json({ error: `IMDb image fetch failed: ${img.status}` });
    }

    const contentType = img.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await img.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buf);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/poster/from-letterboxd", async (req, res) => {
  try {
    const raw = req.query.url;
    if (typeof raw !== "string" || !raw) {
      return res.status(400).json({ error: "Missing Letterboxd url query param." });
    }
    const decoded = decodeURIComponent(raw);
    if (!decoded.startsWith("https://letterboxd.com/film/")) {
      return res.status(400).json({ error: "Invalid Letterboxd film url." });
    }

    const filmPage = await fetch(decoded, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!filmPage.ok) {
      return res.status(502).json({ error: `Letterboxd fetch failed: ${filmPage.status}` });
    }
    const html = await filmPage.text();

    const tmdbId = html.match(/themoviedb\.org\/movie\/(\d+)/i)?.[1];
    if (!tmdbId) {
      return res.status(404).json({ error: "TMDB link not found on Letterboxd page." });
    }

    const tmdbPage = await fetch(`https://www.themoviedb.org/movie/${tmdbId}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!tmdbPage.ok) {
      return res.status(502).json({ error: `TMDB page fetch failed: ${tmdbPage.status}` });
    }
    const tmdbHtml = await tmdbPage.text();
    const marker = 'property="og:image" content="';
    const index = tmdbHtml.indexOf(marker);
    if (index < 0) {
      return res.status(404).json({ error: "TMDB poster not found." });
    }
    const rest = tmdbHtml.slice(index + marker.length);
    const imageUrl = rest.slice(0, rest.indexOf('"'));
    if (!imageUrl.startsWith("http")) {
      return res.status(404).json({ error: "TMDB poster url invalid." });
    }

    const image = await fetch(imageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://www.themoviedb.org/",
      },
    });
    if (!image.ok) {
      return res.status(502).json({ error: `TMDB image fetch failed: ${image.status}` });
    }

    const contentType = image.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await image.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buf);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
