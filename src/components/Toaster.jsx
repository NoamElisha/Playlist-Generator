// /src/components/Toaster.jsx
import React from "react";

export default function Toaster() {
  const [toasts, setToasts] = React.useState([]);

  React.useEffect(() => {
    const onToast = (e) => {
      const id = Math.random().toString(36).slice(2);
      const t = { id, type: e.detail?.type || "info", text: e.detail?.text || "" };
      setToasts((prev) => [...prev, t]);
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4000);
    };
    document.addEventListener("app:toast", onToast);
    window.addEventListener("app:toast", onToast); // גיבוי

    // אופציונלי: עזר לדיבוג מהקונסול
    window.toast = (text, type = "info") =>
      document.dispatchEvent(new CustomEvent("app:toast", { detail: { type, text }, bubbles: true, composed: true }));

    return () => {
      document.removeEventListener("app:toast", onToast);
      window.removeEventListener("app:toast", onToast);
    };
  }, []);

  return (
    <div className="toast-wrap">
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
