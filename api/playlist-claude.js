// api/playlist-claude.js
// Guarantees at least desiredTotal final items (including seeds) and requests Claude to include at least desiredArtistsCount different artists.

const SYSTEM_PROMPT = `
You are an assistant that receives:
- a list of seed songs (each line in the exact format: Title - Artist), and
- two integers: REQUESTED_TOTAL (number of lines the final playlist should contain) and REQUESTED_DISTINCT_ARTISTS (minimum count of distinct artists required).

Your job:
- Produce a final playlist as plain text with EXACTLY REQUESTED_TOTAL lines if possible. Each line MUST be exactly in this format:
    Title - Artist
  (ASCII hyphen `-` with one space on each side; no numbering, no bullets, no headings.)
- The final playlist MUST INCLUDE the original seed songs (the seeds provided) somewhere in the list (they can appear in any order).
- The final playlist SHOULD have at least REQUESTED_DISTINCT_ARTISTS distinct artists (case-insensitive). Try to maximize distinct artists to reach that target.
- Maintain genre/vibe consistency: prefer songs in the same musical genre/vibe as the seed songs. If seeds contain mixed genres, use the majority genre; if there is no clear majority, use the genre of the first seed.
- Prefer (but do not be forced to repeat) other songs by the same artists appearing in the seeds — include those if they fit the genre/vibe and help reach the totals.
- Do NOT repeat the same Title - Artist line more than once. Avoid near-duplicates (e.g., the same song with minor alternate punctuation).
- If a requested constraint cannot be fully met (for example Claude cannot find enough same-genre distinct artists), return the best possible list you can while still following the formatting rules — **do not** add explanations, warnings, or any lines that are not "Title - Artist".
- Do not include release years, labels, links, commentary, numbering, blank lines, or any JSON or metadata — only plain lines "Title - Artist".
- If a song features other performers, format the artist portion naturally, e.g.:
    Blinding Lights - The Weeknd ft. Artist Name
- Use common/recognized song titles (choose the most standard, widely-known title formatting).
- Keep output concise and machine-parsable: exact ASCII hyphen as separator, one song per line, no extra characters around the lines.

Edge behavior (strict instructions for fallback):
- Aim to output exactly REQUESTED_TOTAL lines. If you cannot reach that number while respecting genre/vibe and non-duplication, output as many valid lines as you can (still obey the single-line "Title - Artist" rule) — no commentary. The calling code will handle warnings or retries.
- When instructed to include N distinct artists but the seeds provide fewer artists, prioritize adding songs by new artists of the same vibe until reaching N, then fill remaining lines with best matches (still avoiding duplicate Title - Artist pairs).

Input placeholders:
- The caller will inject the seed lines and the numeric values for REQUESTED_TOTAL and REQUESTED_DISTINCT_ARTISTS in the user message. Do not echo or repeat those numeric placeholders; just produce the playlist output as specified.

Example (seed input, for illustration only — do NOT print anything like "Example:" in your output):
  Seeds: Shape of You - Ed Sheeran | Perfect - Ed Sheeran | Someone Like You - Adele | Rolling in the Deep - Adele | Closer - The Chainsmokers
  REQUESTED_TOTAL = 25
  REQUESTED_DISTINCT_ARTISTS = 7

Valid output (exact format the caller expects — no extra text):
Shape of You - Ed Sheeran
Perfect - Ed Sheeran
Someone Like You - Adele
Rolling in the Deep - Adele
Closer - The Chainsmokers
Thinking Out Loud - Ed Sheeran
Photograph - Ed Sheeran
Set Fire to the Rain - Adele
Make You Feel My Love - Adele
Don't Let Me Down - The Chainsmokers ft. Daya
Stay - Zedd & Alessia Cara
Say You Won't Let Go - James Arthur
Love Yourself - Justin Bieber
Jealous - Labrinth
When I Was Your Man - Bruno Mars
Locked Out of Heaven - Bruno Mars
Treasure - Bruno Mars
Too Good at Goodbyes - Sam Smith
Lay Me Down - Sam Smith
Pompeii - Bastille
Demons - Imagine Dragons
Believer - Imagine Dragons
Uptown Funk - Mark Ronson ft. Bruno Mars
Can't Feel My Face - The Weeknd
Blinding Lights - The Weeknd
`;

const MAX_RETRIES = 2;

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
  // robust extraction (various Claude response shapes)
  if (data?.content?.[0]?.text) return data.content[0].text;
  if (typeof data.completion === 'string' && data.completion.trim()) return data.completion;
  if (Array.isArray(data.completion?.parts)) return data.completion.parts.join('');
  if (Array.isArray(data.messages) && data.messages.length) return data.messages.map(m => m.text || m.content || '').join('\n');
  return JSON.stringify(data);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { songs, desiredArtistsCount = 6, desiredTotal = 25 } = req.body ?? {};
    console.log('playlist-claude: request', { songsLength: Array.isArray(songs) ? songs.length : undefined, desiredArtistsCount, desiredTotal });

    if (!Array.isArray(songs) || songs.length === 0) {
      return res.status(400).json({ error: 'Please provide songs array.' });
    }

    // keep first 5 seeds (or up to 5). But accept more seeds.
    const seeds = songs.map(s => (typeof s === 'string' ? s.trim() : '')).filter(Boolean).slice(0, 20);
    if (seeds.length < 5) return res.status(400).json({ error: 'Please provide at least 5 seed songs.' });

    const targetArtists = Math.max(1, Math.min(50, Number(desiredArtistsCount)));
    const targetTotal = Math.max(5, Math.min(500, Number(desiredTotal)));

    // set of canonical keys to avoid duplicates
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

    // always add provided seeds first (preserve)
    for (let i = 0; i < Math.min(5, seeds.length); i++) addLine(seeds[i]);

    // helper to compute distinct artists in final
    const currentArtistsSet = () => {
      const s = new Set();
      for (const l of final) {
        const p = parseLineToPair(l);
        if (p?.artist) s.add(p.artist.toLowerCase());
      }
      return s;
    };

    // initial prompt (first call)
    const seedFive = seeds.slice(0,5).join(' | ');
    let userMessage = { role: 'user', content: `Here are seed songs (Title - Artist): ${seedFive}. Please produce ${targetTotal} lines (Title - Artist) in the same vibe/genre, and include at least ${targetArtists} distinct artists. Return ONLY plain newline lines "Title - Artist". Make sure the original seeds appear in the final list.` };

    let attempt = 0;
    // iterative loop: call Claude, parse, check distinct artists and totals, ask follow-ups if needed
    while ((final.length < targetTotal || currentArtistsSet().size < targetArtists) && attempt <= MAX_RETRIES) {
      attempt++;
      console.log(`playlist-claude: attempt ${attempt} - have ${final.length} lines, ${currentArtistsSet().size} distinct artists; need total ${targetTotal}, artists ${targetArtists}`);
      const raw = await callClaude([userMessage]);
      console.log('playlist-claude: raw length', raw ? raw.length : 0);
      const lines = linesFromText(raw);
      console.log('playlist-claude: parsed lines', lines.length);

      // add lines in order until targetTotal reached
      for (const l of lines) {
        if (final.length >= targetTotal) break;
        addLine(l);
      }

      // recompute missing counts
      const artistsNow = currentArtistsSet();
      const missingArtists = Math.max(0, targetArtists - artistsNow.size);
      const missingTotal = Math.max(0, targetTotal - final.length);

      // if we still miss distinct artists, prepare a follow-up prompt asking for new artists only
      if (missingArtists > 0 || missingTotal > 0) {
        // build exclude lists
        const excludeTitles = Array.from(seen).slice(0,200).map(k => k.split('|||')[0]).filter(Boolean);
        const excludeArtists = Array.from(artistsNow).slice(0,200);

        // ask for ONLY new artists / songs
        const followUp = `I still need ${missingTotal} more songs to reach ${targetTotal} total, and at least ${missingArtists} additional DISTINCT ARTISTS.
Return ONLY lines "Title - Artist". Do NOT repeat any of these titles or artists (exclude):
Artists to exclude:
${excludeArtists.join('\n')}
Titles to exclude:
${excludeTitles.join('\n')}
Focus on songs in the same genre/vibe as the seeds and prioritize songs by new artists (not in the exclude list).`;
        userMessage = { role: 'user', content: followUp };
        // loop will repeat
      } else {
        // we have enough—break
        break;
      }
    }

    // final safety: if still not enough, pad by repeating seeds variants (worst-case)
    if (final.length < targetTotal) {
      console.log('playlist-claude: padding with seeds variants');
      for (const s of seeds) {
        if (final.length >= targetTotal) break;
        addLine(s);
      }
    }

    const playlistText = final.slice(0, targetTotal).join('\n');
    const distinctArtistsCount = currentArtistsSet().size;
    const success = final.length >= targetTotal && distinctArtistsCount >= targetArtists;
    const warning = success ? null : `Generated ${final.length} items with ${distinctArtistsCount} distinct artists (requested ${targetTotal} and ${targetArtists}).`;

    console.log('playlist-claude: finished:', { count: final.length, distinctArtistsCount, success });

    return res.status(200).json({ playlistText, count: final.length, distinctArtistsCount, success, warning });
  } catch (err) {
    console.error('playlist-claude error:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}