// /src/components/AddToSpotifyButton.jsx
import { parsePlaylistTextToTracks } from "../utils/parsePlaylistText";


function showToast(type, text) {
  const ev = new CustomEvent("app:toast", {
    detail: { type, text },
    bubbles: true,
    composed: true,
  });
  document.dispatchEvent(ev);  // ← במקום window.dispatchEvent
}

export default function AddToSpotifyButton({ playlistText, playlistName }) {
  async function handleAdd() {
    const tracks = parsePlaylistTextToTracks(playlistText);
    try {
      const res = await fetch("/api/spotify/create-playlist", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: playlistName || "AI Playlist", tracks }),
      });

      if (res.status === 401) {
        window.location.href = "/api/spotify/login";
        return;
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create playlist");

      showToast(
        "success",
        `נוצר פלייליסט: ${playlistName || "AI Playlist"} • נוספו ${data.added} שירים`
      );
      if (data.playlistUrl) window.open(data.playlistUrl, "_blank");
    } catch (err) {
      console.error("AddToSpotifyButton error:", err);
      showToast("error", err?.message || String(err));
    }
  }

  return (
    <button onClick={handleAdd} className="btn green" title="הוספת הפלייליסט לחשבון ה-Spotify שלך">
      Add to Spotify
    </button>
  );
}