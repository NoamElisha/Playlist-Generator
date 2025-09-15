// api/playlist-claude.js
// Playlist generator with server-side verification using Spotify Search (client credentials).
// - Strong system prompt (Hebrew).
// - Calls Claude (blocks, fallback legacy).
// - Verifies each "Title - Artist" via Spotify Search and only keeps verified tracks.
// - If not enough verified tracks, asks Claude for replacements (retries).

const SYSTEM_PROMPT = `
אתה עוזר שמקבל:
- רשימה של 5 שירי "seed" (כל שורה בדיוק בפורמט: Title - Artist),
- שני מספרים: REQUESTED_TOTAL ו-REQUESTED_DISTINCT_ARTISTS.

כללי עבודה מחמירים (קרא בקפידה):
1) תמיד כלול (include) את שירי ה-seed ברשימה הסופית.
2) החזר אך ורק שורות טקסט פשוטות, כל שורה בדיוק בפורמט:
   Title - Artist
   (ASCII hyphen '-' עם רווח אחד משני הצדדים). ללא נקודות, ללא כותרות, ללא הסברים, ללא מספרים, ללא כל טקסט נוסף.
3) אל תייצר, אל תעלה על הדעת ואין להמציא שום שיר או כותרת. אם אינך בטוח ב-100% שקיימת שורה מסוימת — אל תכלול אותה.
4) העדף שירים ידועים ומזוהים (well-known / commonly released songs). הימנע משירים נדירים, לא-מפורסמים, או גרסאות לא רשמיות.
5) שמור על שפה וז'אנר: 
   - אם רוב ה-seeds בעברית — כל השירים המתווספים חייבים להיות בעברית ובוצעו על ידי אמנים ישראלים (אותו ז'אנר/vibe ככל האפשר).
   - אם רוב ה-seeds באנגלית — כל השירים חייבים להיות באנגלית ואמנים בינלאומיים.
6) שאף/י לשלב לפחות REQUESTED_DISTINCT_ARTISTS אמנים שונים (אך לא יותר מ-8). אם ה-seeds מספקים פחות אמנים, השלם באמנים מאותו ז'אנר/שפה.
7) אל תחזור על אותו "Title - Artist" פעמיים. הימנע מגרסאות כמעט זהות.
8) השתמש בכותרות סטנדרטיות ומקובלות (לא נוסחאות ארוכות או עם metadata). אם שיר כולל "ft." ציין זאת כחלק מהחלק של ה-Artist.
9) אם אינך יכול לספק את כל הבקשות (חסר באמנים או במספר השורות), פשוט החזר הכי הרבה שורות תקניות שאתה יכול — אך שוב: אך ורק שורות בפורמט "Title - Artist".
10) **שום דבר אחר** לא ייצא — רק שורות "Title - Artist".

(המערכת בצד השרת תאמת את קיום השירים ב-Spotify; לכן תתאמץ לא להציע שירים לא קיימים).
`;

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-3-haiku-20240307';
const MAX_RETRIES = 2;
const MAX_TOTAL = 200;

// helpers
function linesFromText(text) {
  return (text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}

function parseLineToPair(line) {
  const parts = line.split(/[-–—]/).map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const title = parts[0].replace(/^["“”']+|["“”']+$/g, '').trim();
    const artist = parts.slice(1).join(' - ').replace(/^["“”']+|["“”']+$/g, '').trim();
    if (title) return { title, artist };
  }
  return null;
}

function normalizeForCompare(s = '') {
  return s.toString().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\u0590-\u05FF\s]/gi, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function canonicalKey(titleOrRaw, artist = '') {
  return `${(titleOrRaw||'').toString().trim()}|||${(artist||'').toString().trim()}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isHebrewText(s) {
  try { return /[\u0590-\u05FF]/.test(s); } catch(e){ return false; }
}

// Claude Blocks + legacy callers (robust)
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

// --- Spotify verification (Client Credentials) ---
async function getSpotifyAppToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET for verification.');
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error('Spotify token error: ' + txt);
  }
  const data = await r.json();
  return data.access_token;
}

async function searchTrackOnSpotify(accessToken, title, artist) {
  // try a precise query first
  const q1 = `track:"${title}" artist:"${artist}"`;
  const url1 = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q1)}&type=track&limit=5`;
  const r1 = await fetch(url1, { headers: { Authorization: `Bearer ${accessToken}` }});
  if (r1.ok) {
    const d = await r1.json();
    const items = d?.tracks?.items || [];
    for (const it of items) {
      const itTitle = normalizeForCompare(it.name || '');
      const itArtists = (it.artists || []).map(a => normalizeForCompare(a.name || ''));
      if (itTitle && normalizeForCompare(title) === itTitle) {
        // check artist contains or equals
        if (itArtists.some(a => normalizeForCompare(artist).includes(a) || a.includes(normalizeForCompare(artist)) || a.includes(normalizeForCompare(artist).split(' ')[0]))) {
          return { found: true, uri: it.uri, name: it.name, artists: it.artists.map(a=>a.name).join(', ') };
        }
      }
    }
  }

  // fallback: search by title only and try to match artist substrings
  const q2 = `track:"${title}"`;
  const url2 = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q2)}&type=track&limit=10`;
  const r2 = await fetch(url2, { headers: { Authorization: `Bearer ${accessToken}` }});
  if (r2.ok) {
    const d2 = await r2.json();
    const items2 = d2?.tracks?.items || [];
    for (const it of items2) {
      const itTitle = normalizeForCompare(it.name || '');
      const targTitle = normalizeForCompare(title);
      // require title similarity (exact or contains)
      if (itTitle.includes(targTitle) || targTitle.includes(itTitle)) {
        const itArtists = (it.artists || []).map(a => normalizeForCompare(a.name || ''));
        const targArtist = normalizeForCompare(artist);
        if (itArtists.some(a => a.includes(targArtist) || targArtist.includes(a) || a.split(' ')[0] === targArtist.split(' ')[0])) {
          return { found: true, uri: it.uri, name: it.name, artists: it.artists.map(a=>a.name).join(', ') };
        }
      }
    }
  }

  return { found: false };
}

// --- Main handler ---
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

    // language preference
    const hebrewCount = seeds.reduce((c, s) => c + (isHebrewText(s) ? 1 : 0), 0);
    const preferHebrew = hebrewCount >= Math.ceil(seeds.length / 2);
    console.log('playlist-claude: preferHebrew?', preferHebrew, 'hebrewCount', hebrewCount, 'seeds', seeds.length);

    // add parseable seeds to final (must parse)
    const seen = new Set();
    const final = [];

    function addParsedLine(raw) {
      const p = parseLineToPair(raw);
      if (!p || !p.title) return false;
      const key = canonicalKey(p.title, p.artist || '');
      if (seen.has(key)) return false;
      seen.add(key);
      final.push(`${p.title} - ${p.artist}`);
      return true;
    }

    for (let i = 0; i < Math.min(5, seeds.length); i++) {
      const ok = addParsedLine(seeds[i]);
      if (!ok) console.warn('playlist-claude: seed not parseable, skipping seed:', seeds[i]);
    }

    // initial user prompt for Claude
    const seedFive = seeds.slice(0,5).join(' | ');
    let userPrompt = `Here are 5 seed songs (Title - Artist): ${seedFive}.
REQUESTED_TOTAL = ${targetTotal}
REQUESTED_DISTINCT_ARTISTS = ${targetArtists}
Return ONLY newline-separated lines exactly in the form "Title - Artist".
Do NOT include any other text.
If seeds are predominantly Hebrew: generate ONLY Hebrew songs by Israeli artists.
If seeds are predominantly English: generate ONLY international English-language songs (no Hebrew).
Focus on the same genre/vibe as the seeds.
Only suggest songs you are confident actually exist (do NOT invent songs).`;

    let attempt = 0;
    let lastResponseData = null;

    // get spotify token once (optional). If missing env vars, we'll skip verification and return a warning.
    let spotifyToken = null;
    try {
      spotifyToken = await getSpotifyAppToken();
    } catch (e) {
      console.warn('playlist-claude: Spotify verification disabled (missing client credentials or token error):', e.message);
      spotifyToken = null;
    }

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
          throw err;
        }
      }

      lastResponseData = data;
      const rawText = extractTextFromClaudeResponse(data);
      console.log('playlist-claude: rawText length', (rawText || '').length);
      const lines = linesFromText(rawText);
      console.log('playlist-claude: parsed lines count', lines.length);

      // parse and optionally verify each line (if spotifyToken available)
      const parsed = [];
      for (const l of lines) {
        const p = parseLineToPair(l);
        if (!p || !p.title) continue;
        parsed.push(p);
      }

      if (spotifyToken) {
        // verify parsed lines via Spotify
        for (const p of parsed) {
          if (final.length >= targetTotal) break;
          try {
            const v = await searchTrackOnSpotify(spotifyToken, p.title, p.artist);
            if (v && v.found) {
              // use the canonical name from Spotify (but keep "Title - Artist" format)
              const name = v.name || p.title;
              const artists = v.artists || p.artist;
              addParsedLine(`${name} - ${artists}`);
            } else {
              console.log('playlist-claude: suggestion not found on Spotify, skipping:', p.title, '-', p.artist);
            }
          } catch (err) {
            console.warn('playlist-claude: spotify search error for', p.title, p.artist, err?.message || err);
          }
        }
      } else {
        // no verification possible — still add parsed lines but mark a warning later
        for (const p of parsed) {
          if (final.length >= targetTotal) break;
          addParsedLine(`${p.title} - ${p.artist}`);
        }
      }

      // recompute missing counts
      const distinctArtistsNow = new Set(final.map(l => (parseLineToPair(l)?.artist || '').toLowerCase()).filter(Boolean)).size;
      const missingArtists = Math.max(0, targetArtists - distinctArtistsNow);
      const missingTotal = Math.max(0, targetTotal - final.length);

      if (missingArtists > 0 || missingTotal > 0) {
        // build excludes
        const excludeTitles = Array.from(seen).slice(0,200).map(k => k.split('|||')[0]).filter(Boolean);
        const excludeArtists = Array.from(new Set(final.map(l => (parseLineToPair(l)?.artist || '').toLowerCase()))).slice(0,200);

        const followUp = `I still need ${missingTotal} more songs to reach ${targetTotal}, and at least ${missingArtists} additional DISTINCT ARTISTS.
Return ONLY lines "Title - Artist". Do NOT repeat any of these titles or artists (exclude):
Artists to exclude:
${excludeArtists.join('\n')}
Titles to exclude:
${excludeTitles.join('\n')}
If seeds are predominantly Hebrew: generate ONLY Hebrew songs by Israeli artists.
If seeds are predominantly English: generate ONLY international English-language songs (no Hebrew).
Only suggest songs you are confident actually exist; avoid obscure/rare/unreleased tracks.`;

        userPrompt = followUp;
        // loop continues
      } else {
        break; // enough
      }
    }

    // final slice
    const finalLines = final.slice(0, targetTotal);
    const distinctArtistsCount = new Set(finalLines.map(l => (parseLineToPair(l)?.artist || '').toLowerCase()).filter(Boolean)).size;
    const success = finalLines.length >= targetTotal && distinctArtistsCount >= targetArtists;
    const warning = success ? null : `Generated ${finalLines.length} items with ${distinctArtistsCount} distinct artists (requested ${targetTotal} and ${targetArtists}).`;

    // If verification disabled (no spotify creds), include explicit flag so client can show notice
    const verificationAvailable = !!process.env.SPOTIFY_CLIENT_ID && !!process.env.SPOTIFY_CLIENT_SECRET;

    return res.status(200).json({
      playlistText: finalLines.join('\n'),
      count: finalLines.length,
      distinctArtistsCount,
      success,
      warning,
      verificationAvailable,
      // lastResponseData: limited - don't return huge raw objects (optional)
    });
  } catch (err) {
    console.error('playlist-claude error:', err);
    const body = err?.body || err?.message || String(err);
    return res.status(500).json({ error: body });
  }
}
