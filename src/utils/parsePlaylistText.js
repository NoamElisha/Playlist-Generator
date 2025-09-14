// src/utils/parsePlaylistText.js
export function parsePlaylistTextToTracks(text) {
  // מפצל שורה-שורה, מסנן ריקות ו"מנקה" מספרים/תווי מיותר
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const tracks = lines.map(line => {
    // מצפה לפורמט "Title - Artist" או "Title — Artist"
    const sepMatch = line.split(/[-–—]/); // שימוש בסוגי קוים
    if (sepMatch.length >= 2) {
      const title = sepMatch[0].trim().replace(/^\d+\.\s*/, '');
      const artist = sepMatch.slice(1).join('-').trim();
      return { title, artist, raw: line };
    } else {
      // fallback: לא מצליח לפצל — שמור כ־raw
      return { title: line, artist: '', raw: line };
    }
  });

  return tracks;
}
