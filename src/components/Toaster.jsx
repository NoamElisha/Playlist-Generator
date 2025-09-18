// /src/components/Toaster.jsx
import React from "react";

export default function Toaster() {
  const [toasts, setToasts] = React.useState([]);

  React.useEffect(() => {
    const onToast = (e) => {
      const id = Math.random().toString(36).slice(2);
      const t = {
        id,
        type: e?.detail?.type || "info",
        text: e?.detail?.text || "",
      };
      setToasts((prev) => [...prev, t]);
      // 9 שניות (הגדלנו ב+5 שניות)
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== id));
      }, 9000);
    };

    // מאזין יחיד – רק window ו"רק" לאירוע בשם toast
    window.addEventListener("toast", onToast);

    // עזר דיבוג: window.toast("היי", "success")
    window.toast = (text, type = "info") =>
      window.dispatchEvent(new CustomEvent("toast", { detail: { type, text } }));

    return () => {
      window.removeEventListener("toast", onToast);
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
