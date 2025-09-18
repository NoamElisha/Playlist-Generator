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
      setTimeout(
        () => setToasts((prev) => prev.filter((x) => x.id !== id)),
        4000
      );
    };

    // מקשיב ל־"toast" (שם האירוע שהכפתור שולח) וגם ל־"app:toast" לגיבוי
    window.addEventListener("toast", onToast);
    window.addEventListener("app:toast", onToast);

    // עזר לדיבוג בקונסול: toast("שלום", "success")
    window.toast = (text, type = "info") =>
      window.dispatchEvent(new CustomEvent("toast", { detail: { type, text } }));

    return () => {
      window.removeEventListener("toast", onToast);
      window.removeEventListener("app:toast", onToast);
    };
  }, []);

  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          <div className="toast-title">
            {t.type === "success"
              ? "Success 🎉"
              : t.type === "error"
              ? "Error ❗"
              : "Info"}
          </div>
          <div className="toast-text">{t.text}</div>
        </div>
      ))}
    </div>
  );
}
