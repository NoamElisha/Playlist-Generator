export function parsePlaylistTextToTracks(text) {
  // מפצל שורה-שורה, מסנן ריקות ו"מנקה" מספרים/תווי מיותר
  const lines = (text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const tracks = lines.map(line => {
    // מצפה לפורמט "Title - Artist" או "Title — Artist"
    const sepMatch = line.split(/[-–—]/); // שימוש בסוגי קוים
    if (sepMatch.length >= 2) {
      const title = sepMatch[0].trim().replace(/^\d+\.\s*/, '').replace(/^["“”']+|["“”']+$/g, '').trim();
      const artist = sepMatch.slice(1).join('-').trim().replace(/^["“”']+|["“”']+$/g, '').trim();
      return { title, artist, raw: line };
    } else {
      // fallback: לא מצליח לפצל — שמור כ־raw
      const cleaned = line.replace(/^["“”']+|["“”']+$/g, '').trim();
      return { title: cleaned, artist: '', raw: line };
    }
  });

  return tracks;
}
