// /src/Body.jsx
import React from "react";
import SongsList from "./components/SongsList";
import ClaudePlaylist from "./components/ClaudePlaylist";
import AddToSpotifyButton from "./components/AddToSpotifyButton";
import { getPlaylistFromChefClaude } from "./ai";

function parseArtist(line) {
  const parts = (line || "").split(/[-–—]/).map(s => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts.slice(1).join("-").trim() : "";
}
function isValidPlaylistName(name) {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > 100) return false;
  if (/[\x00-\x1F\x7F]/.test(trimmed)) return false;
  return true;
}

export default function Body() {
  const [songs, setSongs] = React.useState([]);
  const [playlistText, setPlaylistText] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [playlistName, setPlaylistName] = React.useState("AI Playlist");

  async function getPlaylist() {
    try {
      setError("");

      // בדיקת 5–12
      if (songs.length < 5) {
        setError("נא להזין לפחות 5 שירים.");
        return;
      }
      if (songs.length > 12) {
        setError("ניתן להזין עד 12 שירים.");
        return;
      }

      // לפחות 5 אמנים שונים
      const uniqArtists = new Set(
        songs.map(parseArtist).filter(Boolean).map(a => a.toLowerCase())
      );
      if (uniqArtists.size < 5) {
        setError("יש צורך בלפחות 5 זמרים/אמנים שונים ברשימה. הוסף אמנים נוספים ונסה שוב.");
        return;
      }

      setLoading(true);
      const data = await getPlaylistFromChefClaude(songs);
      setPlaylistText(data.playlistText || "");

      // ❌ לא מציגים שום warning אם חזר פחות מהיעד
      // if (data.warning) setError(data.warning);

    } catch (err) {
      console.error("getPlaylist error:", err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  function addSong(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const song = f.get("song")?.trim();
    if (!song) return;
    if (songs.length >= 12) {
      setError("ניתן להזין עד 12 שירים.");
      return;
    }
    setSongs(prev => [...prev, song]);
    e.target.reset();
  }

  const finalPlaylistName = isValidPlaylistName(playlistName) ? playlistName.trim() : "AI Playlist";

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      {/* Label + helper ליד שם הפלייליסט */}
      <div className="card" style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>
          שם הפלייליסט
        </label>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <input
            value={playlistName}
            onChange={e => setPlaylistName(e.target.value)}
            placeholder="לדוגמה: Roadtrip Vibes"
            style={{
              padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", flex: 1
            }}
          />
          <span style={{ color: "#6b7280", fontSize: ".9rem" }}>
            זה השם שיופיע כשניצור את הפלייליסט בחשבון ה-Spotify שלך
          </span>
        </div>
      </div>

      <form onSubmit={addSong} className="add-ingredient-form card">
        <input
          name="song"
          placeholder='Example: "Bad Guy - Billie Eilish"'
          aria-label="Add song (Title - Artist)"
        />
        <button type="submit">Add</button>
      </form>

      {songs.length === 0 && (
        <p style={{ color: "#6B7280", marginTop: 12 }}>
          הוסף לפחות 5 שירים (בפורמט <code>Title - Artist</code>) ואז לחץ Generate Playlist.
        </p>
      )}

      <SongsList songs={songs} />

      <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 12 }}>
        <button
          onClick={getPlaylist}
          disabled={songs.length < 5}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            background: "#111827",
            color: "#fff",
            border: "none",
            cursor: songs.length < 5 ? "not-allowed" : "pointer"
          }}
        >
          Generate Playlist
        </button>
      </div>

      {loading && <p>Loading…</p>}

      {/* הודעת שגיאה מודרנית */}
      {error && (
        <div
          className="alert"
          style={{
            margin: "12px auto",
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid #fecaca",
            background: "#fff1f2",
            color: "#7f1d1d",
            maxWidth: 780,
            display: "flex",
            gap: 10,
            alignItems: "center",
            boxShadow: "0 10px 20px rgba(2,6,23,0.04)"
          }}
        >
          <span style={{ fontSize: "1.25rem" }}>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {playlistText && <ClaudePlaylist playlistText={playlistText} />}

      {playlistText && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
          <AddToSpotifyButton playlistText={playlistText} playlistName={finalPlaylistName} />
        </div>
      )}
    </main>
  );
}
