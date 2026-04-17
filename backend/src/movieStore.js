import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.resolve(__dirname, "../../data/movies.json");

let cache = null;

export async function loadMovies() {
  if (cache) return cache;

  const raw = await fs.readFile(DATA_PATH, "utf-8");
  const movies = JSON.parse(raw);
  if (!Array.isArray(movies) || movies.length !== 500) {
    throw new Error("movies.json must contain exactly 500 movies.");
  }
  cache = movies;
  return cache;
}
