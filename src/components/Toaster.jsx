// /src/components/Toaster.jsx
import React from "react";

// חתימה פשוטה למניעת כפילויות קרובות (type+text)
const sig = (e) => `${e?.detail?.type || "info"}|||${e?.detail?.text || ""}`;

export default function Toaster() {
  const [toasts, setToasts] = React.useState([]);
  const lastSigRef = React.useRef("");
  const lastTimeRef = React.useRef(0);

  React.useEffect(() => {
    const onToast = (e) => {
      const s = sig(e);
      const now = Date.now();
      // אם בדיוק אותו מסר הגיע פעמיים בהפרש < 200ms — נתעלם מהשני
      if (lastSigRef.current === s && now - lastTimeRef.current < 200) return;
      lastSigRef.current = s;
      lastTimeRef.current = now;

      const id = Math.random().toString(36).slice(2);
      const t = { id, type: e?.detail?.type || "info", text: e?.detail?.text || "" };
      setToasts((prev) => [...prev, t]);

      // מציגים 9 שניות (4 + 5 שביקשת)
      const TTL = 9000;
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== id));
      }, TTL);
    };

    // מאזין רק על window (לא על document) כדי לא להכפיל
    window.addEventListener("toast", onToast);
    window.addEventListener("app:toast", onToast); // תאימות לאירועים ישנים אם קיימים

    // דיבוג: window.toast("שלום", "success")
    window.toast = (text, type = "info") =>
      window.dispatchEvent(new CustomEvent("toast", { detail: { type, text } }));

    return () => {
      window.removeEventListener("toast", onToast);
      window.removeEventListener("app:toast", onToast);
    };
  }, []);

  return (
    <div className="toast-wrap toast-right">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          <div className="toast-title">
            {t.type === "success" ? "Success 🎉" : t.type === "error" ? "Error ❗" : "Info"}
          </div>
          <div className="toast-text">{t.text}</div>
        </div>
      ))}
    </div>
  );
}
