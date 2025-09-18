import React from "react";

export default function Toaster() {
  const [toasts, setToasts] = React.useState([]);

  React.useEffect(() => {
    function onToast(e) {
      const id = Math.random().toString(36).slice(2);
      const t = { id, type: e.detail?.type || "info", text: e.detail?.text || "" };
      setToasts(prev => [...prev, t]);
      // auto-dismiss after 4s
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), 4000);
    }
    window.addEventListener("toast", onToast);
    return () => window.removeEventListener("toast", onToast);
  }, []);

  return (
    <div className="toast-wrap">
      {toasts.map(t => (
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
