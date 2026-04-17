import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_PATH = path.resolve(__dirname, "../../data/user-state.json");

const DEFAULT_STATE = {
  history: [],
  bySlug: {},
};

let cache = null;
let writeChain = Promise.resolve();

async function ensureLoaded() {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    cache = {
      history: Array.isArray(parsed.history) ? parsed.history : [],
      bySlug: parsed.bySlug && typeof parsed.bySlug === "object" ? parsed.bySlug : {},
    };
  } catch {
    cache = { ...DEFAULT_STATE };
  }
  return cache;
}

function persist() {
  writeChain = writeChain.then(async () => {
    await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
    await fs.writeFile(STATE_PATH, `${JSON.stringify(cache, null, 2)}\n`, "utf-8");
  });
  return writeChain;
}

export async function getUserState() {
  const state = await ensureLoaded();
  return state;
}

export async function recordSpin(movie) {
  const state = await ensureLoaded();
  state.history.unshift({
    slug: movie.slug,
    rank: movie.rank,
    title: movie.title,
    year: movie.year,
    letterboxdUrl: movie.letterboxdUrl,
    at: new Date().toISOString(),
  });
  state.history = state.history.slice(0, 300);
  await persist();
  return state.history;
}

export function isValidRating(value) {
  if (value === null) return true;
  if (typeof value !== "number" || Number.isNaN(value)) return false;
  if (value < 0 || value > 5) return false;
  return Number.isInteger(value * 2);
}

export async function updateMovieState(slug, patch) {
  const state = await ensureLoaded();
  const current = state.bySlug[slug] || {};
  const next = { ...current };
  if (typeof patch.watched === "boolean") next.watched = patch.watched;
  if (Object.hasOwn(patch, "userRating")) next.userRating = patch.userRating;
  next.updatedAt = new Date().toISOString();
  state.bySlug[slug] = next;
  await persist();
  return next;
}
