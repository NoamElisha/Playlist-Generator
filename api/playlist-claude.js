// api/playlist-claude.js
// Robust playlist generator: enforces Title - Artist lines, prefers seed language, no commentary lines.

const SYSTEM_PROMPT = `
You are an assistant that receives:
- a list of 5 seed songs (each line exactly "Title - Artist"),
- integers REQUESTED_TOTAL and REQUESTED_DISTINCT_ARTISTS.

Your strict tasks:
1. Always include the seed songs in the final playlist.
2. Return ONLY plain newline-separated lines in this exact format: Title - Artist
   - Do NOT return any other text, headings, numbering, comments, summaries, or explanations.
3. The final playlist MUST contain between 20 and 40 songs total (based on REQUESTED_TOTAL).
4. The final playlist MUST contain at least REQUESTED_DISTINCT_ARTISTS distinct artists,
   but never more than 8 distinct artists.
5. If the user provides fewer than REQUESTED_DISTINCT_ARTISTS seed artists,
   complete the missing artists with others from the same genre and language as the majority of seeds.
6. Do NOT repeat the same Title - Artist line.
7. Only return real, existing songs with 100% certainty. Avoid hallucinations or made-up titles.
8. If the seeds are mostly Hebrew songs, ALL generated songs must be Hebrew. 
   If seeds are mostly English songs, ALL generated songs must be English.
9. Prefer songs from the same genre/musical vibe as the seeds. Do NOT mix genres.
10. Always balance so that each distinct artist has at least 2–3 songs in the list.

Remember:
- Absolutely no extra output except valid "Title - Artist" lines.
`;

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-3-haiku-20240307';
const MAX_RETRIES = 2;
const MAX_TOTAL = 200;

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
  return `${(titleOrRaw||'').toString().trim()}|||${(artist||'').toString().trim()}`
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function isHebrewText(s) {
  try {
    return /[\u0590-\u05FF]/.test(s);
  } catch (e) { return false; }
}

// --- Claude callers (blocks first, fallback legacy) ---
async function callClaudeBlocks(apiKey, systemPrompt, userPrompt, maxTokens = 2048) {
  const payload = {
    model: MODEL,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: systemPrompt }],
    messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }]
  };
  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  });
  const txt = await r.text();
  let data;
  try { data = JSON.parse(txt); } catch(e) { data = txt; }
  if (!r.ok) {
    const err = new Error(`Claude error ${r.status}: ${txt}`);
    err.status = r.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function callClaudeLegacy(apiKey, systemPrompt, userPrompt, maxTokens = 2048) {
  const payload = { model: MODEL, max_tokens: maxTokens, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] };
  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  });
  const txt = await r.text();
  let data;
  try { data = JSON.parse(txt); } catch(e) { data = txt; }
  if (!r.ok) {
    const err = new Error(`Claude legacy error ${r.status}: ${txt}`);
    err.status = r.status;
    err.body = data;
    throw err;
  }
  return data;
}

function extractTextFromClaudeResponse(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
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

    if (!Array.isArray(songs) || songs.length === 0) return res.status(400).json({ error: 'Please provide songs array.' });

    const seeds = songs.map(s => (typeof s === 'string' ? s.trim() : '')).filter(Boolean).slice(0, 50);
    if (seeds.length < 5) return res.status(400).json({ error: 'Please provide at least 5 seed songs.' });

    const targetArtists = Math.max(1, Math.min(100, Number(desiredArtistsCount)));
    const targetTotal = Math.max(5, Math.min(MAX_TOTAL, Number(desiredTotal)));

    // language preference (majority of seeds)
    const hebrewCount = seeds.reduce((c, s) => c + (isHebrewText(s) ? 1 : 0), 0);
    const preferHebrew = hebrewCount >= Math.ceil(seeds.length / 2);
    console.log('playlist-claude: preferHebrew?', preferHebrew, 'hebrewCount', hebrewCount, 'seeds', seeds.length);

    // dedupe and final array
    const seen = new Set();
    const final = [];

    const addParsedLine = (raw) => {
      const p = parseLineToPair(raw);
      if (!p || !p.title) return false; // reject unparseable lines (important!)
      const key = canonicalKey(p.title, p.artist || '');
      if (seen.has(key)) return false;
      seen.add(key);
      final.push(`${p.title} - ${p.artist}`);
      return true;
    };

    // add seeds (only if parseable)
    for (let i = 0; i < Math.min(5, seeds.length); i++) {
      const ok = addParsedLine(seeds[i]);
      if (!ok) {
        console.warn('playlist-claude: seed not parseable, skipping seed:', seeds[i]);
      }
    }

    // prepare initial prompt (explicit, strict)
    const seedFive = seeds.slice(0,5).join(' | ');
    let userPrompt = `Here are 5 seed songs (Title - Artist): ${seedFive}.
REQUESTED_TOTAL = ${targetTotal}
REQUESTED_DISTINCT_ARTISTS = ${targetArtists}
Return ONLY newline-separated lines exactly in the form "Title - Artist".
Do NOT include any other text. Prefer songs in the same language as the seeds (Hebrew) if seeds are predominantly Hebrew: ${preferHebrew ? 'yes' : 'no'}. Focus on same-genre/vibe suggestions.`;

    let attempt = 0;
    let lastResponseData = null;

    while ((final.length < targetTotal || new Set(final.map(l => (parseLineToPair(l)?.artist || '').toLowerCase()).filter(Boolean)).size < targetArtists) && attempt <= MAX_RETRIES) {
      attempt++;
      console.log(`playlist-claude: attempt ${attempt} - have ${final.length} lines; need total ${targetTotal}`);

      let data;
      try {
        data = await callClaudeBlocks(process.env.ANTHROPIC_API_KEY, SYSTEM_PROMPT, userPrompt);
      } catch (err) {
        console.warn('playlist-claude: blocks call failed:', err?.message || err);
        const msg = String(err?.message || JSON.stringify(err?.body || ''));
        if (err?.status === 400 && (msg.includes('valid list') || msg.includes('invalid_request_error') || msg.includes('system: Input'))) {
          console.log('playlist-claude: fallback to legacy payload due to specific 400.');
          data = await callClaudeLegacy(process.env.ANTHROPIC_API_KEY, SYSTEM_PROMPT, userPrompt);
        } else {
          throw err; // other error -> bubble up
        }
      }

      lastResponseData = data;
      const rawText = extractTextFromClaudeResponse(data);
      console.log('playlist-claude: rawText length', (rawText || '').length);
      const lines = linesFromText(rawText);
      console.log('playlist-claude: parsed lines count', lines.length);

      // Parse lines to pairs, then optionally prefer language
      const parsedLines = [];
      for (const l of lines) {
        const p = parseLineToPair(l);
        if (p && p.title) parsedLines.push({ raw: `${p.title} - ${p.artist}`, title: p.title, artist: p.artist, hebrew: isHebrewText(l) });
      }

      // prefer lines that match desired language
      const preferred = parsedLines.filter(pl => pl.hebrew === preferHebrew);
      const nonPreferred = parsedLines.filter(pl => pl.hebrew !== preferHebrew);

      // add preferred first
      for (const pl of preferred) {
        if (final.length >= targetTotal) break;
        addParsedLine(pl.raw);
      }
      // then non-preferred if still needed
      for (const pl of nonPreferred) {
        if (final.length >= targetTotal) break;
        addParsedLine(pl.raw);
      }

      // prepare follow-up if still missing
      const distinctArtistsNow = new Set(final.map(l => (parseLineToPair(l)?.artist || '').toLowerCase()).filter(Boolean)).size;
      const missingArtists = Math.max(0, targetArtists - distinctArtistsNow);
      const missingTotal = Math.max(0, targetTotal - final.length);

      if (missingArtists > 0 || missingTotal > 0) {
        const excludeTitles = Array.from(seen).slice(0,200).map(k => k.split('|||')[0]).filter(Boolean);
        const excludeArtists = Array.from(new Set(final.map(l => (parseLineToPair(l)?.artist || '').toLowerCase()))).slice(0,200);

        const followUp = `I still need ${missingTotal} more songs to reach ${targetTotal}, and at least ${missingArtists} additional DISTINCT ARTISTS.
Return ONLY lines "Title - Artist". Do NOT repeat any of these titles or artists (exclude):
Artists to exclude:
${excludeArtists.join('\n')}
Titles to exclude:
${excludeTitles.join('\n')}
Prefer songs in the same language as seeds: ${preferHebrew ? 'Hebrew' : 'same-language-if-any'}.`;

        userPrompt = followUp;
        // loop and call again if necessary
      } else {
        break; // got enough
      }
    }

    // final safety: ensure at least seeds are present; if not parseable seeds were skipped, we keep going
    const finalLines = final.slice(0, targetTotal);

    const distinctArtistsCount = new Set(finalLines.map(l => (parseLineToPair(l)?.artist || '').toLowerCase()).filter(Boolean)).size;
    const success = finalLines.length >= targetTotal && distinctArtistsCount >= targetArtists;
    const warning = success ? null : `Generated ${finalLines.length} items with ${distinctArtistsCount} distinct artists (requested ${targetTotal} and ${targetArtists}).`;

    console.log('playlist-claude: finished', { count: finalLines.length, distinctArtistsCount, success });

    return res.status(200).json({ playlistText: finalLines.join('\n'), count: finalLines.length, distinctArtistsCount, success, warning, lastResponseData: typeof lastResponseData === 'object' ? (lastResponseData?.content ? undefined : lastResponseData) : undefined });
  } catch (err) {
    console.error('playlist-claude error:', err);
    const body = err?.body || err?.message || String(err);
    return res.status(500).json({ error: body });
  }
}
