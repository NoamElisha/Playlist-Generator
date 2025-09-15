// api/playlist-claude.js
// Robust server-side playlist generator using Anthropic Claude.
// Tries content-blocks "system" payload first, falls back to legacy format on specific 400 errors.

const SYSTEM_PROMPT = `
You are an assistant that receives:
- a list of seed songs (each line in the exact format: Title - Artist), and
- two integers: REQUESTED_TOTAL (number of lines the final playlist should contain) and REQUESTED_DISTINCT_ARTISTS (minimum count of distinct artists required).

Your job:
- Produce a final playlist as plain text with EXACTLY REQUESTED_TOTAL lines if possible. Each line MUST be exactly in this format:
    Title - Artist
  (ASCII hyphen '-' with one space on each side; no numbering, no bullets, no headings.)
- The final playlist MUST INCLUDE the original seed songs (the seeds provided) somewhere in the list (they can appear in any order).
- The final playlist SHOULD have at least REQUESTED_DISTINCT_ARTISTS distinct artists (case-insensitive). Try to maximize distinct artists to reach that target.
- Maintain genre/vibe consistency: prefer songs in the same musical genre/vibe as the seed songs. If seeds contain mixed genres, use the majority genre; if there is no clear majority, use the genre of the first seed.
- Prefer (but do not be forced to repeat) other songs by the same artists appearing in the seeds — include those if they fit the genre/vibe and help reach the totals.
- Do NOT repeat the same Title - Artist line more than once. Avoid near-duplicates (e.g., the same song with minor alternate punctuation).
- If a requested constraint cannot be fully met (for example Claude cannot find enough same-genre distinct artists), return the best possible list you can while still following the formatting rules — do not add explanations or any additional non "Title - Artist" lines.
- Do not include release years, labels, links, commentary, numbering, blank lines, or any JSON or metadata — only plain lines "Title - Artist".
- Format featuring artists naturally, e.g.: Blinding Lights - The Weeknd ft. Artist Name
- Keep output concise and machine-parsable: exact ASCII hyphen as separator, one song per line, no extra characters around the lines.

Edge behavior (fallback):
- Aim to output exactly REQUESTED_TOTAL lines. If impossible while obeying the rules, output as many valid lines as you can (still one "Title - Artist" per line).
- When asked to include N distinct artists but the seeds give fewer artists, prioritize adding songs by new artists of the same vibe until reaching N, then fill remaining lines with best matches (still avoiding duplicate Title - Artist pairs).
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
  return `${(titleOrRaw||'').toString().trim()}|||${(artist||'').toString().trim()}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function callClaudeBlocks(apiKey, systemPrompt, userPrompt, maxTokens = 2048) {
  // system as array of content blocks, messages with content blocks
  const payload = {
    model: MODEL,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: systemPrompt }],
    messages: [
      { role: 'user', content: [{ type: 'text', text: userPrompt }] }
    ]
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

  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = text; }

  if (!r.ok) {
    const err = new Error(`Claude error ${r.status}: ${text}`);
    err.status = r.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function callClaudeLegacy(apiKey, systemPrompt, userPrompt, maxTokens = 2048) {
  // older shape: system as string, messages with user content string
  const payload = {
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
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
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = text; }
  if (!r.ok) {
    const err = new Error(`Claude legacy error ${r.status}: ${text}`);
    err.status = r.status;
    err.body = data;
    throw err;
  }
  return data;
}

function extractTextFromClaudeResponse(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  // prefer .content[0].text
  if (data?.content?.[0]?.text) return data.content[0].text;
  if (typeof data.completion === 'string' && data.completion.trim()) return data.completion;
  if (Array.isArray(data.completion?.parts)) return data.completion.parts.join('');
  if (Array.isArray(data.messages) && data.messages.length) return data.messages.map(m => m.text || m.content || '').join('\n');
  // last resort
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

    const seeds = songs.map(s => (typeof s === 'string' ? s.trim() : '')).filter(Boolean).slice(0, 50);
    if (seeds.length < 5) return res.status(400).json({ error: 'Please provide at least 5 seed songs.' });

    const targetArtists = Math.max(1, Math.min(100, Number(desiredArtistsCount)));
    const targetTotal = Math.max(5, Math.min(MAX_TOTAL, Number(desiredTotal)));

    // dedupe/canonical helper
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

    // always include the first 5 seed songs to ensure presence
    for (let i = 0; i < Math.min(5, seeds.length); i++) addLine(seeds[i]);

    const currentArtistsSet = () => {
      const s = new Set();
      for (const l of final) {
        const p = parseLineToPair(l);
        if (p?.artist) s.add(p.artist.toLowerCase());
      }
      return s;
    };

    // prepare initial user message (we will supply numbers in prompt text)
    const seedFive = seeds.slice(0,5).join(' | ');
    let userPrompt = `Here are seed songs (Title - Artist): ${seedFive}.
REQUESTED_TOTAL = ${targetTotal}
REQUESTED_DISTINCT_ARTISTS = ${targetArtists}
Please output the playlist as newline-separated lines exactly in the format "Title - Artist". Include the original seeds somewhere in the list. Prefer songs in the same vibe/genre as the seeds. No extra text.`;

    let attempt = 0;
    let lastResponseData = null;

    while ((final.length < targetTotal || currentArtistsSet().size < targetArtists) && attempt <= MAX_RETRIES) {
      attempt++;
      console.log(`playlist-claude: calling Claude attempt ${attempt}. have ${final.length} lines, ${currentArtistsSet().size} artists; need total ${targetTotal}, artists ${targetArtists}`);

      let data;
      try {
        // try blocks format first
        data = await callClaudeBlocks(process.env.ANTHROPIC_API_KEY, SYSTEM_PROMPT, userPrompt);
      } catch (err) {
        console.warn('playlist-claude: blocks call failed:', err?.message || err);
        // check for known error message that indicates blocks/system array required vs invalid
        const msg = String(err?.message || err?.body || '');
        // if server explicitly complains about "system: Input should be a valid list" or invalid_request_error -> fallback
        if (err?.status === 400 && (msg.includes('valid list') || msg.includes('invalid_request_error') || msg.includes('system: Input'))) {
          console.log('playlist-claude: falling back to legacy payload due to 400 invalid_request_error about system/input format');
          // try legacy
          data = await callClaudeLegacy(process.env.ANTHROPIC_API_KEY, SYSTEM_PROMPT, userPrompt);
        } else {
          // other error -> rethrow so outer catch returns 500
          throw err;
        }
      }

      lastResponseData = data;
      const rawText = extractTextFromClaudeResponse(data);
      console.log('playlist-claude: rawText length', (rawText || '').length);
      const lines = linesFromText(rawText);
      console.log('playlist-claude: parsed lines count', lines.length);

      for (const l of lines) {
        if (final.length >= targetTotal) break;
        addLine(l);
      }

      // recompute needs
      const artistsNow = currentArtistsSet();
      const missingArtists = Math.max(0, targetArtists - artistsNow.size);
      const missingTotal = Math.max(0, targetTotal - final.length);

      if (missingArtists > 0 || missingTotal > 0) {
        // prepare follow-up excluding used titles/artists to ask for more unique ones
        const excludeTitles = Array.from(seen).slice(0,200).map(k => k.split('|||')[0]).filter(Boolean);
        const excludeArtists = Array.from(artistsNow).slice(0,200);

        const followUp = `I still need ${missingTotal} more songs to reach ${targetTotal} total, and at least ${missingArtists} additional DISTINCT ARTISTS.
Return ONLY lines "Title - Artist". Do NOT repeat any of these titles or artists (exclude):
Artists to exclude:
${excludeArtists.join('\n')}
Titles to exclude:
${excludeTitles.join('\n')}
Focus on songs in the same vibe/genre as the seeds.`;

        userPrompt = followUp;
        // loop will try again
      } else {
        // got enough
        break;
      }
    }

    // ensure seeds are present (safety)
    for (const seed of seeds.slice(0,5)) {
      const p = parseLineToPair(seed);
      const key = canonicalKey(p ? p.title : seed, p ? p.artist : '');
      if (!seen.has(key)) {
        final.unshift(p ? `${p.title} - ${p.artist}` : seed);
        seen.add(key);
      }
    }

    // pad with seeds if still short (worst-case, but avoids returning empty)
    if (final.length < targetTotal) {
      for (const s of seeds) {
        if (final.length >= targetTotal) break;
        addLine(s);
      }
    }

    const finalLines = final.slice(0, targetTotal);
    const distinctArtistsCount = new Set(finalLines.map(l => (parseLineToPair(l)?.artist || '').toLowerCase()).filter(Boolean)).size;
    const success = finalLines.length >= targetTotal && distinctArtistsCount >= targetArtists;
    const warning = success ? null : `Generated ${finalLines.length} items with ${distinctArtistsCount} distinct artists (requested ${targetTotal} and ${targetArtists}).`;

    console.log('playlist-claude: finished', { count: finalLines.length, distinctArtistsCount, success });

    return res.status(200).json({ playlistText: finalLines.join('\n'), count: finalLines.length, distinctArtistsCount, success, warning, lastResponseData });
  } catch (err) {
    console.error('playlist-claude error:', err);
    // try to return any structured message if available
    const body = err?.body || err?.message || String(err);
    return res.status(500).json({ error: body });
  }
}
