import React from "react";

const STATIC_SONGS = [
  { title:"חיכיתי", artist:"שרית חדד" },
  { title:"מי שמאמין", artist:"אייל גולן" },
  { title:"שני משוגעים", artist:"עומר אדם" },
  { title:"שמלה שחורה", artist:"עדן חסון" },
  { title:"מתוקה מהחיים", artist:"ליאור נרקיס" },
  { title:"תגידו לה", artist:"דודו אהרון" },
  { title:"אם רק נאמין", artist:"התקווה 6" },
  { title:"זה בא ממך", artist:"טונה" },
  { title:"ממה את מפחדת", artist:"איתי לוי" },
  { title:"היא לא יודעת מה עובר עלי", artist:"משה פרץ" },
  { title:"מסתובב", artist:"עידן רייכל" },
  { title:"תודה", artist:"נצ'י נצ'" },
];

export default function SuggestedSongs({ selectedSongs, onAdd }) {
  const [dynamicTracks, setDynamicTracks] = React.useState([]);

  const selectedSet = React.useMemo(
    () => new Set(selectedSongs.map(s => s.toLowerCase().trim())),
    [selectedSongs]
  );


  const pickedArtists = React.useMemo(() => {
    const out = [];
    const seen = new Set();
    for (const line of selectedSongs) {
      const parts = line.split(/[-–—]/).map(s=>s.trim());
      if (parts.length >= 2) {
        const a = parts.slice(1).join("-"); // אחרי המקף
        const k = a.toLowerCase();
        if (a && !seen.has(k)) { seen.add(k); out.push(a); }
      }
    }
    return out.slice(0,5);
  }, [selectedSongs]);

  // טוען Top Tracks מה־Spotify לפי האמנים שנבחרו
  React.useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      const out = [];
      for (const a of pickedArtists) {
        // מוצא artist id
        const s = await fetch(`/api/spotify/search?q=${encodeURIComponent(a)}&type=artist&limit=1`, { signal: ctrl.signal });
        const sj = await s.json();
        const id = sj?.artists?.[0]?.id;
        if (!id) continue;
        // מביא Top Tracks
        const r = await fetch(`/api/spotify/artist-top-tracks?id=${id}`, { signal: ctrl.signal });
        const j = await r.json();
        (j.tracks || []).slice(0,3).forEach(t => out.push({ title:t.name, artist:t.artist }));
      }
      setDynamicTracks(out);
    })().catch(()=>{});
    return () => ctrl.abort();
  }, [pickedArtists]);

  const chip = (t) => {
    const line = `${t.title} - ${t.artist}`;
    const selected = selectedSet.has(line.toLowerCase());
    return (
      <button
        key={line}
        type="button"
        className={`chip ${selected ? "selected" : ""}`}
        style={{ cursor:"pointer" }}
        onClick={() => onAdd(line)}
        title={selected ? "נבחר" : "הוסף לפלייליסט"}
      >
        {selected ? "✓" : "+"} {t.title} — {t.artist}
      </button>
    );
  };

  return (
    <div className="card">
      <div className="section-title">Quick picks (ישראל)</div>
      <div className="chips">{STATIC_SONGS.map(chip)}</div>

      {dynamicTracks.length > 0 && (
        <>
          <div className="section-title" style={{marginTop:12}}>From your artists</div>
          <div className="chips">{dynamicTracks.map(chip)}</div>
        </>
      )}
    </div>
  );
}
