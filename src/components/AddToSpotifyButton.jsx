// /src/components/AddToSpotifyButton.jsx
import { parsePlaylistTextToTracks } from "../utils/parsePlaylistText";

export default function AddToSpotifyButton({ playlistText, playlistName }) {
  

  async function handleAdd() {
    const tracks = parsePlaylistTextToTracks(playlistText);
    try {
      console.log(
        "▶ Creating playlist on Spotify, tracks:",
        tracks,
        "name:",
        playlistName
      );
      const res = await fetch("/api/spotify/create-playlist", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: playlistName || "AI Playlist", tracks }),
      });

      console.log("create-playlist: HTTP status", res.status);

      if (res.status === 401) {
        console.log("Not authenticated, redirecting to Spotify login...");
        window.location.href = "/api/spotify/login";
        return;
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create playlist");

 
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            type: "success",
            text: `נוצר פלייליסט: ${playlistName || "AI Playlist"} • נוספו ${
              data.added
            } שירים`,
          },
        })
      );
      if (data.playlistUrl) {
        window.open(data.playlistUrl, "_blank");
      }
    } catch (err) {
      console.error("AddToSpotifyButton error:", err);
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { type: "error", text: err?.message || String(err) },
        })
      );
    }
  }

  return (
    <button
      onClick={handleAdd}
      className="btn green"
      title="הוספת הפלייליסט לחשבון ה-Spotify שלך"
    >
      Add to Spotify
    </button>
  );
}
