// /src/components/AddToSpotifyButton.jsx
import { parsePlaylistTextToTracks } from "../utils/parsePlaylistText";

function emitToast(type, text) {
  // משגרים רק אירוע אחד בשם "toast" לשני הערוצים למקרה שמאזין יושב על document
  const ev = new CustomEvent("toast", { detail: { type, text } });
  window.dispatchEvent(ev);
  document.dispatchEvent(new CustomEvent("toast", { detail: { type, text } }));
}

export default function AddToSpotifyButton({ playlistText, playlistName }) {
  async function handleAdd() {
    const tracks = parsePlaylistTextToTracks(playlistText || "");
    if (!tracks.length) {
      emitToast("error", "אין שירים ברשימה. נסה לייצר פלייליסט מחדש.");
      return;
    }

    try {
      console.log("▶ Creating playlist on Spotify, tracks:", tracks, "name:", playlistName);

      const res = await fetch("/api/spotify/create-playlist", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: (playlistName || "AI Playlist"), tracks }),
      });

      console.log("create-playlist: HTTP status", res.status);

      if (res.status === 401) {
        console.log("Not authenticated, redirecting to Spotify login...");
        window.location.href = "/api/spotify/login";
        return;
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create playlist");

      emitToast(
        "success",
        `נוצר פלייליסט: ${playlistName || "AI Playlist"} • נוספו ${data.added} שירים`
      );

      if (data.playlistUrl) {
        window.open(data.playlistUrl, "_blank");
      }
    } catch (err) {
      console.error("AddToSpotifyButton error:", err);
      emitToast("error", err?.message || String(err));
    }
  }

  return (
    <button
      type="button"
      onClick={handleAdd}
      className="btn green"
      title="הוספת הפלייליסט לחשבון ה-Spotify שלך"
    >
      Add to Spotify
    </button>
  );
}
