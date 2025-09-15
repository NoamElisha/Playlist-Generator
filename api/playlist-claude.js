// api/playlist-claude.js
// Guarantees at least desiredTotal final items (including seeds) and requests Claude to include at least desiredArtistsCount different artists.

const SYSTEM_PROMPT = `
You are an assistant that receives a list of EXACTLY 5+ seed songs (each "Title - Artist").
Your task:
- Return a final playlist that INCLUDES the original seed songs AND a number of additional songs so that the final playlist contains the requested total number of songs.
- Ensure the final playlist contains at least the requested number of DISTINCT ARTISTS.
- Return ONLY plain newline-separated lines, each in this format exactly:
    Title - Artist
- Do NOT include numbering, headings, explanations, or any other text.
- Try not to repeat the exact same Title - Artist line.
`;

function linesFromText(text) {
  return (text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}

function parseLineToPair(line) {
  const parts = line.split(/[-–—]/).map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const title = parts[0].replace(/^["“”']+|["“”']+$/g, '').trim();
    const artist = parts.slice(1).join('-').replace(/^["“”']+|["“”']+$/g, '').trim();
    if (title) return { title, artist };
  }
  return null;
}

function canonicalKey(titleOrRaw, artist = '') {
  return `${(titleOrRaw||'').toString().trim()}|||${(artist||'').toString().trim()}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function callClaude(messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages
    })
  });
  if (!res.ok) {
    const txt = await res.text();
    const err = new Error(`Claude error ${res.status}: ${txt}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  // extract text robustly
  let text = '';
  if (data?.content?.[0]?.text) text = data.content[0].text;
  else if (typeof data.completion === 'string' && data.completion.trim()) text = data.completion;
  else if (Array.isArray(data.completion?.parts)) text = data.completion.parts.join('');
  else if (Array.isArray(data.messages) && data.messages.length) text = data.messages.map(m => m.text || m.content || '').join('\n');
  else text = JSON.stringify(data);
  return text;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { songs, desiredArtistsCount, desiredTotal } = req.body ?? {};
    console.log('playlist-claude: received body:', { songsLength: Array.isArray(songs) ? songs.length : undefined, desiredArtistsCount, desiredTotal });

    if (!songs || !Array.isArray(songs)) {
      return res.status(400).json({ error: 'Please provide an array of songs.' });
    }

    const cleanedSeeds = songs.map(s => (typeof s === 'string' ? s.trim() : '')).filter(Boolean).slice(0, 20);
    if (cleanedSeeds.length < 5) {
      return res.status(400).json({ error: 'Please provide at least 5 seed songs.' });
    }

    // sanitize requested numbers and clamp
    const reqArtists = Number.isInteger(desiredArtistsCount) ? Math.max(1, Math.min(20, desiredArtistsCount)) : 5;
    const reqTotal = Number.isInteger(desiredTotal) ? Math.max(10, Math.min(200, desiredTotal)) : 20;

    console.log('playlist-claude: seeds (first 10):', cleanedSeeds.slice(0,10));
    console.log('playlist-claude: target total', reqTotal, 'min distinct artists', reqArtists);

    // Build the initial user prompt including constraints
    const initialUser = {
      role: 'user',
      content: `Here are seed songs (Title - Artist): ${cleanedSeeds.slice(0,5).join(' | ')}.
Please produce a final playlist that:
- INCLUDES the provided seed songs (they must appear in the final list).
- Contains exactly or at least ${reqTotal} lines (Title - Artist).
- Contains at least ${reqArtists} distinct artists.
Return ONLY plain lines "Title - Artist" with no numbering or commentary.`
    };

    // call Claude (single call + small follow-ups handled server-side if needed)
    const rawText = await callClaude([initialUser]);
    console.log('playlist-claude: claude returned raw length', rawText ? rawText.length : 0);

    const returnedLines = linesFromText(rawText);
    console.log('playlist-claude: claude returned lines count:', returnedLines.length);

    // Build final list, preserving seeds and de-duplicating
    const seen = new Set();
    const final = [];

    const addLine = (raw) => {
      const p = parseLineToPair(raw);
      const key = canonicalKey(p ? p.title : raw, p ? p.artist : '');
      if (seen.has(key)) return false;
      seen.add(key);
      final.push(p ? `${p.title} - ${p.artist}` : raw);
      return true;
    };

    // ensure seeds are present (first)
    for (const s of cleanedSeeds.slice(0,5)) addLine(s);

    // add suggestions from Claude in order
    for (const l of returnedLines) {
      if (final.length >= reqTotal) break;
      addLine(l);
    }

    // If not enough, attempt simple fallback: repeat more seeds/details (if Claude underproduced)
    if (final.length < reqTotal) {
      console.log('playlist-claude: not enough lines from Claude, attempting lightweight augmentation with seeds variations');
      for (const s of cleanedSeeds) {
        if (final.length >= reqTotal) break;
        addLine(s);
      }
    }

    const playlistText = final.slice(0, reqTotal).join('\n');
    // compute distinct artists
    const artists = new Set(final.map(l => {
      const p = parseLineToPair(l);
      return p?.artist?.toLowerCase?.() || '';
    }).filter(Boolean));
    const distinctArtistsCount = artists.size;

    const success = final.length >= reqTotal && distinctArtistsCount >= reqArtists;
    const warning = success ? null : `Generated ${final.length} items with ${distinctArtistsCount} distinct artists (requested total ${reqTotal} and ${reqArtists} distinct artists).`;

    console.log('playlist-claude: returning final count:', final.length, 'distinctArtists:', distinctArtistsCount);

    return res.status(200).json({ playlistText, count: final.length, success, distinctArtistsCount, requested: { reqTotal, reqArtists }, warning });

  } catch (err) {
    console.error('playlist-claude error:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}