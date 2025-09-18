
import { useState } from "react";
import { parsePlaylistTextToTracks } from "../utils/parsePlaylistText";

function emitToast(type, text) {
  const ev = new CustomEvent("toast", { detail: { type, text } });
 
  window.dispatchEvent(ev);
  document.dispatchEvent(new CustomEvent("toast", { detail: { type, text } }));
}

export default function AddToSpotifyButton({ playlistText, playlistName }) {
  const [busy, setBusy] = useState(false);

  async function handleAdd() {
    if (busy) return;
    const tracks = parsePlaylistTextToTracks(playlistText || "");
    if (!tracks.length) {
      emitToast("error", "אין שירים ברשימה. נסה לייצר פלייליסט מחדש.");
      return;
    }

    try {
      setBusy(true);
      const res = await fetch("/api/spotify/create-playlist", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: (playlistName && playlistName.trim()) || "AI Playlist",
          tracks,
        }),
      });

      if (res.status === 401) {
    
        window.location.href = "/api/spotify/login";
        return;
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create playlist");

      emitToast(
        "success",
        `נוצר פלייליסט: ${(playlistName && playlistName.trim()) || "AI Playlist"} • נוספו ${data.added} שירים`
      );

      if (data.playlistUrl) {
        window.open(data.playlistUrl, "_blank");
      }
    } catch (err) {
      console.error("AddToSpotifyButton error:", err);
      emitToast("error", err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"                
      onClick={handleAdd}
      className="btn green"
      title="הוספת הפלייליסט לחשבון ה-Spotify שלך"
      disabled={busy}
      style={{ opacity: busy ? 0.7 : 1, pointerEvents: busy ? "none" : "auto" }}
    >
      {busy ? "Adding…" : "Add to Spotify"}
    </button>
  );
}
