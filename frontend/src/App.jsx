import { useEffect, useMemo, useRef, useState } from "react";

const API_URL = "http://localhost:4000/api/movies";
const HISTORY_URL = "http://localhost:4000/api/history";
const SPINS_URL = "http://localhost:4000/api/spins";
const POSTER_PROXY_URL = "http://localhost:4000/api/poster";
const SEGMENTS = 500;
const TAU = Math.PI * 2;
const POINTER_ANGLE = -Math.PI / 2;

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function createAudio() {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  return {
    tick() {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = "square";
      osc.frequency.value = 1200;
      gain.gain.setValueAtTime(0.001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.05, audioContext.currentTime + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.03);
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.035);
    },
    reveal() {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(400, audioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(900, audioContext.currentTime + 0.15);
      gain.gain.setValueAtTime(0.001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.25);
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.26);
    },
    ensureRunning() {
      if (audioContext.state === "suspended") {
        audioContext.resume();
      }
    },
  };
}

function drawWheel(canvas, rotation, movies) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.45;
  const segmentAngle = TAU / SEGMENTS;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);

  for (let i = 0; i < SEGMENTS; i += 1) {
    const start = i * segmentAngle;
    const end = start + segmentAngle;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? "#f4c14f" : "#7f5a14";
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.14, 0, TAU);
  ctx.fillStyle = "#111";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(POINTER_ANGLE);
  ctx.beginPath();
  ctx.moveTo(radius + 8, 0);
  ctx.lineTo(radius + 42, -16);
  ctx.lineTo(radius + 42, 16);
  ctx.closePath();
  ctx.fillStyle = "#00e6ff";
  ctx.shadowColor = "#00e6ff";
  ctx.shadowBlur = 20;
  ctx.fill();
  ctx.restore();

  if (movies.length === 500) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.font = "600 14px Inter, system-ui";
    ctx.fillText("500 Movies Loaded", 16, 30);
  }
}

function rotationForIndex(index, currentRotation) {
  const segmentAngle = TAU / SEGMENTS;
  const centerAngle = index * segmentAngle + segmentAngle / 2;
  const targetAbsolute = POINTER_ANGLE - centerAngle;
  const minTurns = 8 + Math.floor(Math.random() * 5);

  const normalizedCurrent = ((currentRotation % TAU) + TAU) % TAU;
  const normalizedTarget = ((targetAbsolute % TAU) + TAU) % TAU;
  let delta = normalizedTarget - normalizedCurrent;
  if (delta < 0) delta += TAU;
  return currentRotation + minTurns * TAU + delta;
}

function indexUnderPointer(rotation) {
  const segmentAngle = TAU / SEGMENTS;
  const adjusted = ((POINTER_ANGLE - rotation) % TAU + TAU) % TAU;
  return Math.floor(adjusted / segmentAngle) % SEGMENTS;
}

function formatRating(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "N/A";
  return `${value.toFixed(2)} / 5`;
}

function getPosterSrc(movie) {
  if (movie?.poster) {
    return `${POSTER_PROXY_URL}?url=${encodeURIComponent(movie.poster)}`;
  }
  if (movie?.letterboxdUrl) {
    return `${POSTER_PROXY_URL}/from-letterboxd?url=${encodeURIComponent(
      movie.letterboxdUrl
    )}`;
  }
  if (movie?.imdbId) {
    return `${POSTER_PROXY_URL}/imdb/${movie.imdbId}`;
  }
  return null;
}

const RATING_OPTIONS = Array.from({ length: 11 }, (_, i) => i * 0.5);

export default function App() {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const tickStateRef = useRef(-1);
  const audioRef = useRef(null);

  const [movies, setMovies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState(null);
  const [posterFailed, setPosterFailed] = useState(false);
  const [history, setHistory] = useState([]);
  const [manageSearch, setManageSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [page, setPage] = useState(
    window.location.hash === "#history"
      ? "history"
      : window.location.hash === "#manage"
      ? "manage"
      : "roulette"
  );

  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash === "#history") setPage("history");
      else if (window.location.hash === "#manage") setPage("manage");
      else setPage("roulette");
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    setPosterFailed(false);
  }, [result?.slug, result?.imdbId]);

  useEffect(() => {
    audioRef.current = createAudio();
    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(API_URL);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch movies");
        if (!Array.isArray(data.movies) || data.movies.length !== 500) {
          throw new Error("Backend must return exactly 500 movies");
        }
        setMovies(data.movies);
        const h = await fetch(HISTORY_URL).then((r) => r.json());
        setHistory(h.history || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    drawWheel(canvasRef.current, rotation, movies);
  }, [rotation, movies]);

  const canSpin = useMemo(() => movies.length === 500 && !spinning, [movies, spinning]);

  function spin() {
    if (!canSpin) return;
    audioRef.current?.ensureRunning();
    setSpinning(true);
    setResult(null);
    tickStateRef.current = -1;

    const selected = Math.floor(Math.random() * SEGMENTS);
    const target = rotationForIndex(selected, rotation);
    const start = performance.now();
    const duration = 7800 + Math.random() * 1200;
    const startRotation = rotation;

    const frame = (now) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      const eased = easeOutCubic(t);
      const nextRotation = startRotation + (target - startRotation) * eased;
      setRotation(nextRotation);

      const seg = indexUnderPointer(nextRotation);
      if (seg !== tickStateRef.current) {
        tickStateRef.current = seg;
        audioRef.current?.tick();
      }

      if (t < 1) {
        rafRef.current = requestAnimationFrame(frame);
      } else {
        const landed = indexUnderPointer(target);
        const movie = movies[landed];
        setResult(movie);
        setSpinning(false);
        audioRef.current?.reveal();
        fetch(SPINS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: movie.slug }),
        })
          .then((r) => r.json())
          .then((d) => setHistory(d.history || []))
          .catch(() => {});
      }
    };

    rafRef.current = requestAnimationFrame(frame);
  }

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        spin();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  async function saveMovieState(slug, patch) {
    const res = await fetch(`http://localhost:4000/api/movie/${slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save");
    setMovies((prev) =>
      prev.map((m) => (m.slug === slug ? { ...m, ...patch } : m))
    );
    if (result?.slug === slug) {
      setResult((prev) => ({ ...prev, ...patch }));
    }
  }

  const filteredMovies = useMemo(() => {
    const q = manageSearch.trim().toLowerCase();
    if (!q) return movies;
    return movies.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        String(m.rank).includes(q) ||
        (m.director || "").toLowerCase().includes(q)
    );
  }, [movies, manageSearch]);

  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return history;
    return history.filter((h) => h.title.toLowerCase().includes(q));
  }, [history, historySearch]);

  return (
    <main className="app">
      <div className="bg-glow" />
      <header className="topbar">
        <div>
          <h1>Movie Roulette</h1>
          <p className="subtitle">Spin. Scream. Screenshot. Repeat.</p>
        </div>
        <nav className="page-nav">
          <button
            className={`nav-btn ${page === "roulette" ? "active" : ""}`}
            onClick={() => {
              window.location.hash = "";
              setPage("roulette");
            }}
          >
            Roulette
          </button>
          <button
            className={`nav-btn ${page === "history" ? "active" : ""}`}
            onClick={() => {
              window.location.hash = "history";
              setPage("history");
            }}
          >
            History
          </button>
          <button
            className={`nav-btn ${page === "manage" ? "active" : ""}`}
            onClick={() => {
              window.location.hash = "manage";
              setPage("manage");
            }}
          >
            Manage
          </button>
        </nav>
      </header>

      {page === "roulette" && (
        <section className="layout-grid">
          <section className="roulette-shell">
            <canvas ref={canvasRef} width={720} height={720} />
            <div className="button-row">
              <button className="spin-btn" onClick={spin} disabled={!canSpin}>
                {spinning ? "Spinning..." : "Spin Roulette"}
              </button>
              <button className="secondary-btn" onClick={spin} disabled={!canSpin}>
                Spin Again
              </button>
            </div>
          </section>

          <section className="result-panel">
            {!result && (
              <div className="result-empty">
                <h2>Ready to discover tonight&apos;s movie?</h2>
                <p>Hit spin and let cinema fate choose your next masterpiece.</p>
              </div>
            )}

            {result && (
              <section className="result-card show">
                {getPosterSrc(result) && !posterFailed ? (
                  <img
                    src={getPosterSrc(result)}
                    alt={`${result.title} poster`}
                    onError={(e) => {
                      setPosterFailed(true);
                    }}
                  />
                ) : (
                  <div className="poster-fallback">Poster unavailable</div>
                )}
                <div>
                  <p className="pill">List #{result.rank ?? "N/A"}</p>
                  <h2>
                    {result.title} ({result.year})
                  </h2>
                  <p>
                    <strong>Rating:</strong> {formatRating(result.rating)}
                  </p>
                  <p>
                    <strong>Director:</strong> {result.director}
                  </p>
                  <p>
                    <strong>Genres:</strong> {result.genres.join(", ")}
                  </p>
                  <p>
                    <strong>Top Cast:</strong> {result.cast.join(", ")}
                  </p>
                  <p>
                    <label>
                      <input
                        type="checkbox"
                        checked={Boolean(result.watched)}
                        onChange={(e) =>
                          saveMovieState(result.slug, { watched: e.target.checked })
                        }
                      />{" "}
                      Watched
                    </label>
                  </p>
                  <p>
                    <strong>My Rating:</strong>{" "}
                    <select
                      value={result.userRating ?? ""}
                      onChange={(e) =>
                        saveMovieState(result.slug, {
                          userRating: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    >
                      <option value="">Not rated</option>
                      {RATING_OPTIONS.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </p>
                  <a
                    className="movie-link"
                    href={result.letterboxdUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open on Letterboxd
                  </a>
                </div>
              </section>
            )}
          </section>
        </section>
      )}

      {page === "history" && (
        <section className="history-card">
          <h3>Spin History</h3>
          <p className="history-sub">Saved persistently. Search and revisit anytime.</p>
          <input
            className="search-input"
            placeholder="Search history..."
            value={historySearch}
            onChange={(e) => setHistorySearch(e.target.value)}
          />
          {history.length === 0 && <p>No spins yet. Go spin first 🎡</p>}
          <ul>
            {filteredHistory.map((m, idx) => (
              <li key={`${m.slug || m.imdbId || m.title}-${idx}`}>
                <span>
                  #{m.rank ?? "N/A"} - {m.title} ({m.year})
                </span>
                <a
                  href={
                    m.letterboxdUrl ||
                    movies.find((x) => x.slug === m.slug)?.letterboxdUrl ||
                    "#"
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  Link
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {page === "manage" && (
        <section className="history-card">
          <h3>My Movie Tracker</h3>
          <p className="history-sub">Mark watched/unwatched and save your own rating.</p>
          <input
            className="search-input"
            placeholder="Search by title, rank, director..."
            value={manageSearch}
            onChange={(e) => setManageSearch(e.target.value)}
          />
          <ul>
            {filteredMovies.slice(0, 200).map((m) => (
              <li key={m.slug}>
                <span>
                  #{m.rank} - {m.title}
                </span>
                <span>
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(m.watched)}
                      onChange={(e) =>
                        saveMovieState(m.slug, { watched: e.target.checked })
                      }
                    />{" "}
                    Watched
                  </label>{" "}
                  <select
                    value={m.userRating ?? ""}
                    onChange={(e) =>
                      saveMovieState(m.slug, {
                        userRating: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  >
                    <option value="">No rating</option>
                    {RATING_OPTIONS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading && <p className="status">Loading 500 movies...</p>}
      {error && <p className="status error">{error}</p>}
    </main>
  );
}
