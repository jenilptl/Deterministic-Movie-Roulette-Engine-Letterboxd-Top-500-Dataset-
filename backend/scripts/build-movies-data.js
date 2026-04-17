import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const LETTERBOXD_LIST_BASE =
  "https://letterboxd.com/official/list/letterboxds-top-500-films";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_PATH = path.resolve(__dirname, "../../data/movies.json");

function decodeHtmlEntity(text) {
  if (!text) return text;
  return text
    .replaceAll("&#039;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'");
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${url}`);
  }
  return response.text();
}

function parseImdbListPage(html) {
  const items = [];
  const pattern =
    /data-item-name="([^"]+)"[\s\S]*?data-item-link="(\/film\/[a-z0-9-]+\/)"/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const name = decodeHtmlEntity(match[1].trim());
    const link = match[2];
    const yearMatch = name.match(/\((\d{4})\)$/);
    const title = name.replace(/\s*\(\d{4}\)$/, "").trim();
    const year = yearMatch ? Number(yearMatch[1]) : null;
    const slug = link.replace(/^\/film\//, "").replace(/\/$/, "");
    items.push({ slug, letterboxdUrl: `https://letterboxd.com${link}`, title, year });
  }

  return items;
}

async function fetchLetterboxd500() {
  const all = [];
  for (let page = 1; page <= 5; page += 1) {
    const url = `${LETTERBOXD_LIST_BASE}/page/${page}/`;
    console.log(`Fetching Letterboxd page ${page}/5`);
    const html = await fetchText(url);
    all.push(...parseImdbListPage(html));
  }

  const bySlug = new Map();
  all.forEach((m) => {
    if (!bySlug.has(m.slug)) bySlug.set(m.slug, m);
  });
  const movies = [...bySlug.values()].slice(0, 500).map((m, idx) => ({
    ...m,
    rank: idx + 1,
  }));
  if (movies.length !== 500) {
    throw new Error(
      `Expected ranked 1..500 movies from Letterboxd list, got ${movies.length}.`
    );
  }
  return movies;
}

function extractRating(html) {
  const twitterMatch = html.match(
    /<meta\s+name="twitter:data2"\s+content="([0-9.]+)\s+average rating"/i
  );
  if (twitterMatch) return Number(twitterMatch[1]);

  const jsonLdMatch = html.match(/"ratingValue":"?([0-9.]+)"?/i);
  if (jsonLdMatch) return Number(jsonLdMatch[1]);
  return null;
}

function extractPoster($, html) {
  const candidates = [
    $("div.film-poster img").first().attr("src"),
    $("img[src*='film-poster']").first().attr("src"),
    $("meta[name='twitter:image']").attr("content"),
    $("meta[property='og:image']").attr("content"),
  ].filter(Boolean);

  const regex =
    /https?:\/\/[^"']*ltrbxd\.com\/resized\/[^"']*film-poster[^"']+/gi;
  const fromHtml = html.match(regex) || [];
  const url = candidates[0] || fromHtml[0] || null;
  if (!url) return null;

  if (url.includes("empty-poster")) return null;

  // Upgrade resized portrait poster URLs to a larger still-safe size.
  return url.replace(/-0-\d+-0-\d+-crop/g, "-0-1000-0-1500-crop");
}

async function fetchImdbPoster(imdbId) {
  if (!imdbId) return null;
  try {
    const html = await fetchText(`https://www.imdb.com/title/${imdbId}/`);
    const og = html.match(
      /<meta\s+property="og:image"\s+content="([^"]+)"/i
    )?.[1];
    return og || null;
  } catch {
    return null;
  }
}

async function enrichMovie(movie) {
  const html = await fetchText(movie.letterboxdUrl);
  const $ = cheerio.load(html);

  const title = $("meta[property='og:title']").attr("content")?.split("(")[0]?.trim();
  const year =
    Number(
      $("a[href*='/films/year/']")
        .first()
        .text()
        .match(/(19|20)\d{2}/)?.[0]
    ) || movie.year;
  let poster = extractPoster($, html);

  const genres = [];
  $("a[href^='/films/genre/']").each((_, el) => {
    const g = $(el).text().trim();
    if (g && !genres.includes(g) && genres.length < 3) genres.push(g);
  });

  const directors = [];
  $("a[href^='/director/']").each((_, el) => {
    const name = $(el).text().trim();
    if (name && !directors.includes(name)) directors.push(name);
  });

  const cast = [];
  $(".cast-list a, #tab-cast a[href*='/actor/']").each((_, el) => {
    const name = $(el).text().trim();
    if (name && !cast.includes(name) && cast.length < 3) cast.push(name);
  });

  const imdbId = html.match(/imdb\.com\/title\/(tt\d+)/i)?.[1] || null;
  const rating = extractRating(html);
  if (!poster) {
    poster = await fetchImdbPoster(imdbId);
  }

  return {
    rank: movie.rank,
    slug: movie.slug,
    letterboxdUrl: movie.letterboxdUrl,
    imdbId,
    title: title || movie.title || movie.slug,
    year,
    poster,
    rating,
    genres,
    director: directors[0] || "Unknown",
    cast,
  };
}

async function main() {
  console.log("Building movie data from Letterboxd Top 500 source...");
  const listMovies = await fetchLetterboxd500();

  const enriched = [];
  for (let i = 0; i < listMovies.length; i += 1) {
    const movie = listMovies[i];
    process.stdout.write(`Enriching ${i + 1}/500: ${movie.title}\r`);
    const full = await enrichMovie(movie);
    enriched.push(full);
  }

  if (enriched.length !== 500) {
    throw new Error(`Expected 500 enriched movies, got ${enriched.length}.`);
  }

  const ids = new Set(enriched.map((m) => m.slug));
  if (ids.size !== 500) {
    throw new Error(`Duplicate slugs found. Unique count: ${ids.size}`);
  }

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(enriched, null, 2)}\n`, "utf-8");
  console.log(`\nDone. Wrote 500 movies to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error("\nData build failed:", error.message);
  process.exit(1);
});
