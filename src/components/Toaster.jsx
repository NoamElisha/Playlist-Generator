// /src/components/Toaster.jsx
import React from "react";

// דה-דופליקציה: אם הגיעו כמה אירועים זהים (type+text) באותו רגע – נבלע כפולים
function makeSig(e) {
  const type = e?.detail?.type || "info";
  const text = e?.detail?.text || "";
  return `${type}|||${text}`;
}

export default function Toaster() {
  const [toasts, setToasts] = React.useState([]);
  const lastSigRef = React.useRef(null);
  const lastTimeRef = React.useRef(0);

  React.useEffect(() => {
    const onToast = (e) => {
      const sig = makeSig(e);
      const now = Date.now();
      // אם קיבלנו בדיוק אותו מסר פעמיים בתוך 200ms – נתעלם מהכפול
      if (lastSigRef.current === sig && now - lastTimeRef.current < 200) return;
      lastSigRef.current = sig;
      lastTimeRef.current = now;

      const id = Math.random().toString(36).slice(2);
      const t = {
        id,
        type: e?.detail?.type || "info",
        text: e?.detail?.text || "",
      };
      setToasts((prev) => [...prev, t]);

      // 9 שניות תצוגה
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== id));
      }, 9000);
    };

    // מאזינים לשני השמות ועל שני היעדים, כדי לקלוט הכל – עם דה-דופליקציה
    const names = ["toast", "app:toast"];
    names.forEach((n) => {
      window.addEventListener(n, onToast);
      document.addEventListener(n, onToast);
    });

    // עזר דיבוג נוח: window.toast("hello", "success")
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
