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

      // דרישת התחברות
      if (res.status === 401) {
        window.location.href = "/api/spotify/login";
        return;
      }

      // קוראים את הגוף פעם אחת
      const text = await res.text();
      let payload = {};
      try {
        payload = JSON.parse(text || "{}");
      } catch {
        // אם זה לא JSON, נשאיר אובייקט ריק ונשתמש בהודעות דיפולט
      }

      // טיפול בשגיאה בצד שרת (כולל DEV MODE / AUTH FLOW)
      if (!res.ok) {
        let msg = "אירעה שגיאה. נסה שוב מאוחר יותר.";
        if (payload?.code === "DEVELOPMENT_MODE") {
          msg =
            "האפליקציה כרגע במצב פיתוח וזמינה רק למשתמשים שאושרו מראש. פנה למפתח כדי לקבל גישה.";
        } else if (payload?.code === "AUTH_FLOW_ERROR") {
          msg = "נכשלה ההתחברות ל-Spotify. נסה להתחבר שוב ואז לחזור לכאן.";
        } else if (payload?.error) {
          msg = payload.error;
        }
        emitToast("error", msg);
        return;
      }

      // הצלחה
      emitToast(
        "success",
        `נוצר פלייליסט: ${
          (playlistName && playlistName.trim()) || "AI Playlist"
        } • נוספו ${payload.added ?? 0} שירים`
      );

      if (payload.playlistUrl) {
        window.open(payload.playlistUrl, "_blank");
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
