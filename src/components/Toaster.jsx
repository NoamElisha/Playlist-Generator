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
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== id));
      }, 4000);
    };

    // נאזין גם ל-window וגם ל-document לשם "toast" ו-"app:toast"
    const names = ["toast", "app:toast"];
    names.forEach((n) => {
      window.addEventListener(n, onToast);
      document.addEventListener(n, onToast);
    });

    // עזר דיבוג: window.toast("הי", "success")
    window.toast = (text, type = "info") =>
      window.dispatchEvent(new CustomEvent("toast", { detail: { type, text } }));

    return () => {
      names.forEach((n) => {
        window.removeEventListener(n, onToast);
        document.removeEventListener(n, onToast);
      });
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
