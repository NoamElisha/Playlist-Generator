// /src/components/TypeaheadInput.jsx
import React from "react";

const DEBOUNCE_MS = 250;

export default function TypeaheadInput({ disabled, onAdd, maxItems = 12 }) {
  const [q, setQ] = React.useState("");
  const [artists, setArtists] = React.useState([]);
  const [tracks, setTracks] = React.useState([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [highlight, setHighlight] = React.useState({ section: "tracks", index: 0 }); // or "artists"
  const [expandedArtistId, setExpandedArtistId] = React.useState(null);
  const [expandedTracks, setExpandedTracks] = React.useState([]); // top-tracks of selected artist

  const inputRef = React.useRef(null);
  const boxRef = React.useRef(null);
  const tRef = React.useRef(null);

  function close() {
    setOpen(false);
    setExpandedArtistId(null);
    setExpandedTracks([]);
  }

  React.useEffect(() => {
    function onDocClick(e) {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target)) close();
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  React.useEffect(() => {
    if (!q || q.trim().length < 2) {
      setArtists([]); setTracks([]); setOpen(!!q);
      return;
    }
    clearTimeout(tRef.current);
    tRef.current = setTimeout(async () => {
      try {
        setLoading(true);
        const r = await fetch(`/api/spotify/search?q=${encodeURIComponent(q)}&type=artist,track&limit=7`);
        const data = await r.json();
        setArtists(data.artists || []);
        setTracks(data.tracks || []);
        setOpen(true);
        // reset highlight to first item available
        if ((data.tracks || []).length) {
          setHighlight({ section: "tracks", index: 0 });
        } else if ((data.artists || []).length) {
          setHighlight({ section: "artists", index: 0 });
        }
      } catch (e) {
        // ignore
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(tRef.current);
  }, [q]);

  async function expandArtistTop(artist) {
    if (expandedArtistId === artist.id) {
      setExpandedArtistId(null);
      setExpandedTracks([]);
      return;
    }
    setExpandedArtistId(artist.id);
    setExpandedTracks([]);
    try {
      const r = await fetch(`/api/spotify/artist-top-tracks?id=${encodeURIComponent(artist.id)}`);
      const data = await r.json();
      setExpandedTracks(data.tracks || []);
    } catch {}
  }

  function selectTrack(track) {
    if (!track?.name || !track?.artist) return;
    const line = `${track.name} - ${track.artist}`; // הפורמט שומר תאימות
    onAdd?.(line);
    setQ("");
    setArtists([]); setTracks([]);
    setExpandedArtistId(null);
    setExpandedTracks([]);
    setOpen(false);
  }

  function onKeyDown(e) {
    if (!open) return;
    const totalT = tracks.length;
    const totalA = artists.length;

    const move = (dir) => {
      const list = highlight.section === "tracks" ? tracks : artists;
      const len = list.length;
      if (!len) {
        // hop to other section if possible
        if (highlight.section === "tracks" && totalA) setHighlight({ section: "artists", index: 0 });
        else if (highlight.section === "artists" && totalT) setHighlight({ section: "tracks", index: 0 });
        return;
      }
      let idx = highlight.index + dir;
      if (idx < 0) {
        // wrap to previous section
        if (highlight.section === "tracks" && totalA) setHighlight({ section: "artists", index: Math.max(0, totalA - 1) });
        else if (highlight.section === "artists" && totalT) setHighlight({ section: "tracks", index: Math.max(0, totalT - 1) });
      } else if (idx >= len) {
        // wrap to next section
        if (highlight.section === "tracks" && totalA) setHighlight({ section: "artists", index: 0 });
        else if (highlight.section === "artists" && totalT) setHighlight({ section: "tracks", index: 0 });
      } else {
        setHighlight({ section: highlight.section, index: idx });
      }
    };

    if (e.key === "ArrowDown") { e.preventDefault(); move(+1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (highlight.section === "tracks" && tracks[highlight.index]) {
        selectTrack(tracks[highlight.index]);
      } else if (highlight.section === "artists" && artists[highlight.index]) {
        expandArtistTop(artists[highlight.index]);
      }
    } else if (e.key === "Escape") {
      close();
    }
  }

  return (
    <div ref={boxRef} style={{ position: "relative", width: "100%" }}>
      <input
        ref={inputRef}
        value={q}
        onChange={e => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder='חפש זמר/שיר… למשל: "אייל גולן" או "Bad Guy"'
        aria-label="Search artist or track"
        style={{ padding: 10, borderRadius: 8, border: "1px solid #e5e7eb", width: "100%" }}
      />

      {open && (artists.length || tracks.length || loading) ? (
        <div
          className="autocomplete-scroll"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            boxShadow: "0 10px 30px rgba(2,6,23,0.12)",
            zIndex: 20
            // אין overflow/maxHeight כאן — זה מגיע מה-CSS .autocomplete-scroll
          }}
        >
          {loading && (
            <div style={{ padding: 10, color: "#6b7280", fontSize: ".9rem" }}>מחפש…</div>
          )}

          {tracks.length > 0 && (
            <div>
              <div style={{ padding: "8px 12px", fontSize: ".8rem", color: "#6b7280" }}>שירים</div>
              {tracks.map((t, idx) => {
                const active = highlight.section === "tracks" && highlight.index === idx;
                return (
                  <div
                    key={t.id}
                    onMouseEnter={() => setHighlight({ section: "tracks", index: idx })}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => selectTrack(t)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: 10, cursor: "pointer",
                      background: active ? "#f3f4f6" : "#fff"
                    }}
                  >
                    {t.image && <img src={t.image} alt="" width={36} height={36} style={{ borderRadius: 6, objectFit: "cover" }} />}
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: ".95rem" }}>{t.name}</span>
                      <span style={{ fontSize: ".8rem", color: "#6b7280" }}>{t.artist}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {artists.length > 0 && (
            <div style={{ borderTop: "1px solid #f1f5f9" }}>
              <div style={{ padding: "8px 12px", fontSize: ".8rem", color: "#6b7280" }}>אמנים</div>
              {artists.map((a, idx) => {
                const active = highlight.section === "artists" && highlight.index === idx;
                const expanded = expandedArtistId === a.id;
                return (
                  <div key={a.id} style={{ borderTop: "1px solid #f8fafc" }}>
                    <div
                      onMouseEnter={() => setHighlight({ section: "artists", index: idx })}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => expandArtistTop(a)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, padding: 10, cursor: "pointer",
                        background: active ? "#f3f4f6" : "#fff"
                      }}
                    >
                      {a.image && <img src={a.image} alt="" width={36} height={36} style={{ borderRadius: "50%", objectFit: "cover" }} />}
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: ".95rem" }}>{a.name}</span>
                        <span style={{ fontSize: ".8rem", color: "#6b7280" }}>הצג שירים פופולריים</span>
                      </div>
                    </div>
                    {expanded && expandedTracks.length > 0 && (
                      <div style={{ background: "#fafafa", padding: "6px 8px" }}>
                        {expandedTracks.slice(0, 6).map(t => (
                          <div
                            key={t.id}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => selectTrack(t)}
                            style={{
                              display: "flex", alignItems: "center", gap: 10, padding: 8, cursor: "pointer",
                              borderRadius: 8
                            }}
                          >
                            {t.image && <img src={t.image} alt="" width={28} height={28} style={{ borderRadius: 6, objectFit: "cover" }} />}
                            <div style={{ display: "flex", flexDirection: "column" }}>
                              <span style={{ fontSize: ".9rem" }}>{t.name}</span>
                              <span style={{ fontSize: ".75rem", color: "#6b7280" }}>{t.artist}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!loading && tracks.length === 0 && artists.length === 0 && (
            <div style={{ padding: 10, color: "#6b7280", fontSize: ".9rem" }}>לא נמצאו תוצאות.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
