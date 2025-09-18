// src/Body.jsx
import React from "react";
import TypeaheadInput from "./components/TypeaheadInput";
import AddToSpotifyButton from "./components/AddToSpotifyButton";
import { getPlaylistFromChefClaude } from "./ai";
import SuggestedSongs from "./components/SuggestedSongs";

function parseArtist(line) {
  const parts = (line || "")
    .split(/[-–—]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length >= 2 ? parts.slice(1).join("-").trim() : "";
}
function isValidPlaylistName(name) {
  if (!name) return false;
  const s = name.trim();
  return s.length > 0 && s.length <= 100 && !/[\x00-\x1F\x7F]/.test(s);
}

export default function Body() {
  const [view, setView] = React.useState("select"); // "select" | "result"
  const [songs, setSongs] = React.useState([]);
  const [playlistText, setPlaylistText] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [playlistName, setPlaylistName] = React.useState("My Awesome Playlist");

  const uniqArtists = React.useMemo(() => {
    const s = new Set(
      songs
        .map(parseArtist)
        .filter(Boolean)
        .map((a) => a.toLowerCase())
    );
    return Array.from(s);
  }, [songs]);

  const artistsDisplay = React.useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const line of songs) {
      const a = parseArtist(line);
      const k = a.toLowerCase();
      if (a && !seen.has(k)) {
        seen.add(k);
        out.push(a);
      }
    }
    return out;
  }, [songs]);

  const artistsProgress = (Math.min(uniqArtists.length, 5) / 5) * 100;

  async function getPlaylist() {
    try {
      setError("");
      if (songs.length < 5) return setError("נא להזין לפחות 5 שירים.");
      if (songs.length > 12) return setError("ניתן להזין עד 12 שירים.");
      if (uniqArtists.length < 5) {
        return setError("יש צורך בלפחות 5 זמרים/אמנים שונים.");
      }
      setLoading(true);
      const data = await getPlaylistFromChefClaude(songs);
      setPlaylistText(data.playlistText || "");
      setView("result");
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  const finalPlaylistName = isValidPlaylistName(playlistName)
    ? playlistName.trim()
    : "AI Playlist";

  return (
    <main className="page">
      {view === "select" && (
        <>
          {/* Playlist name */}
          <div className="card">
            <div className="section-title">Playlist name</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <input
                className="input"
                value={playlistName}
                onChange={(e) => setPlaylistName(e.target.value)}
                placeholder="e.g. Night Drive Vibes"
              />
              <span className="inline-note">
                זה השם שיופיע כשניצור את הפלייליסט בחשבון ה-Spotify שלך
              </span>
            </div>
          </div>

          {/* Search + typeahead */}
          <div className="card">
            <div className="section-title">Search for songs</div>
            <TypeaheadInput
              disabled={songs.length >= 12}
              onAdd={(line) => {
                if (songs.length >= 12)
                  return setError("ניתן להזין עד 12 שירים.");
                if (
                  songs.some(
                    (s) => s.toLowerCase().trim() === line.toLowerCase().trim()
                  )
                )
                  return setError("השיר כבר קיים ברשימה.");
                setSongs((prev) => [...prev, line]);
                setError("");
              }}
              maxItems={12}
            />
            <p className="inline-note" style={{ marginTop: 8 }}>
              בחירה מוסיפה בפורמט <code>Title - Artist</code>. ניתן להוסיף 5–12
              שירים.
            </p>
          </div>

          {/* 🔥 Suggested quick picks (ישראל + דינמי מהאמנים שנבחרו) */}
          <SuggestedSongs
            selectedSongs={songs}
            onAdd={(line) => {
              if (songs.length >= 12)
                return setError("ניתן להזין עד 12 שירים.");
              if (
                songs.some(
                  (s) => s.toLowerCase().trim() === line.toLowerCase().trim()
                )
              )
                return setError("השיר כבר קיים ברשימה.");
              setSongs((prev) => [...prev, line]);
              setError("");
            }}
          />

          {/* Progress */}
          <div className="card">
            <div className="section-title">Progress</div>
            <div className="progress" aria-label="artists progress">
              <div className="fill" style={{ width: `${artistsProgress}%` }} />
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 8,
                color: "#cfd0ff",
              }}
            >
              <span>
                {uniqArtists.length}/5+ artists selected ({songs.length} songs)
              </span>
            </div>

            {!!artistsDisplay.length && (
              <>
                <div className="section-title" style={{ marginTop: 12 }}>
                  Selected artists
                </div>
                <div className="chips">
                  {artistsDisplay.map((a) => (
                    <span key={a} className="chip">
                      {a}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* User songs */}
          <div className="card">
            <div className="section-title">Your songs</div>
            {songs.length === 0 ? (
              <p className="inline-note">הוסף לפחות 5 שירים כדי להמשיך.</p>
            ) : (
              <ul
                className="user-songs"
                style={{ textAlign: "left", maxWidth: 760, margin: "8px auto" }}
              >
                {songs.map((s, i) => (
                  <li
                    key={i}
                    style={{
                      marginBottom: 6,
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <span>{s}</span>
                    <button
                      className="btn small ghost"
                      onClick={() =>
                        setSongs((prev) => prev.filter((_, idx) => idx !== i))
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {error && (
              <div
                style={{
                  marginTop: 12,
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid #6b1f1f",
                  background: "#2a0f15",
                  color: "#ffb3b3",
                }}
              >
                ⚠️ {error}
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginTop: 14,
              }}
            >
              <button
                className="btn primary"
                onClick={getPlaylist}
                disabled={songs.length < 5 || loading}
              >
                {loading ? "Generating…" : "Generate Playlist"}
              </button>
            </div>
          </div>
        </>
      )}

      {view === "result" && (
        <>
          <div style={{ marginBottom: 12 }}>
            <button
              className="btn ghost small"
              onClick={() => setView("select")}
            >
              ← Back to Selection
            </button>
          </div>

          <div className="result-header">
            <div className="result-title">
              <span className="disc" />
              Your AI-Generated Playlist
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <AddToSpotifyButton
                playlistText={playlistText}
                playlistName={finalPlaylistName}
              />
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="section-title">Based on your selections:</div>
            <div className="chips">
              {songs.slice(0, 5).map((s, i) => (
                <span
                  className="chip"
                  key={i}
                  style={{ background: "#232347" }}
                >
                  {s}
                </span>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="section-title">Generated Playlist</div>
            <ol className="playlist">
              {(playlistText || "")
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter(Boolean)
                .map((line, i) => {
                  const parts = line.split(/[-–—]/).map((s) => s.trim());
                  const title = parts.length >= 2 ? parts[0] : line; // fallback
                  const artist =
                    parts.length >= 2 ? parts.slice(1).join(" - ") : "";
                  return (
                    <li key={i}>
                      <span className="track-title">{title}</span>
                      <span className="track-meta">{artist}</span>
                    </li>
                  );
                })}
            </ol>
            { <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginTop: 14,
              }}
            >
              <AddToSpotifyButton
                playlistText={playlistText}
                playlistName={finalPlaylistName}
              />
            </div> }
          </div>
        </>
      )}
    </main>
  );
}
