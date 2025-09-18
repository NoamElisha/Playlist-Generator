export function parsePlaylistTextToTracks(text) {

  const lines = (text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const tracks = lines.map(line => {

    const sepMatch = line.split(/[-–—]/);
    if (sepMatch.length >= 2) {
      const title = sepMatch[0].trim().replace(/^\d+\.\s*/, '').replace(/^["“”']+|["“”']+$/g, '').trim();
      const artist = sepMatch.slice(1).join('-').trim().replace(/^["“”']+|["“”']+$/g, '').trim();
      return { title, artist, raw: line };
    } else {

      const cleaned = line.replace(/^["“”']+|["“”']+$/g, '').trim();
      return { title: cleaned, artist: '', raw: line };
    }
  });

  return tracks;
}
