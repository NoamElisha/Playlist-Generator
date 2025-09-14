// api/playlist-claude.js
// Guarantees at least 20 final items (5 seeds + >=15 suggestions).
const SYSTEM_PROMPT = `
You are an assistant that receives a list of EXACTLY 5 seed songs (each "Title - Artist").
Your task:
- Return a final playlist that INCLUDES the original 5 seed songs AND at least 15 additional songs that are musically similar (same vibe/genre/mood).
- DO NOT suggest songs that are from a different musical genre than the seed songs.
  * If the 5 seeds are mixed genres, use the majority genre. If there is no clear majority, use the genre of the first provided seed.
- Prefer (give higher priority to) songs by the SAME ARTISTS listed in the seeds (i.e., include other songs from those same artists where relevant).
- Return ONLY plain newline-separated lines, each line exactly in this format:
    Title - Artist
  Do NOT include numbering, headings, explanations, or any other text.
- The final list SHOULD contain the original 5 seed songs (anywhere in the list) and at least 15 additional suggestions (so total >=20 lines).
- Be strict: if you cannot find suitable same-genre suggestions, still return only same-genre songs (do not return different-genre artists).
`;

const TARGET_TOTAL = 20;
const MAX_TOTAL = 40; // safety hard cap
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
      max_tokens: 1024,
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
  // robust extraction
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
    const { songs } = req.body ?? {};
    console.log('playlist-claude: received songs:', songs);

    if (!songs || !Array.isArray(songs)) {
      return res.status(400).json({ error: 'Please provide an array of songs.' });
    }

    const seedsRaw = songs
      .map(s => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      .slice(0, 5);

    if (seedsRaw.length < 5) {
      return res.status(400).json({ error: 'Please provide an array of at least 5 songs.' });
    }

    // prepare initial user message
    const initialUser = { role: 'user', content: `Here are 5 seed songs (Title - Artist): ${seedsRaw.join(' | ')}. Provide at least 15 additional songs similar in vibe/genre. Return only lines "Title - Artist".` };

    // aggregated list of final raw lines
    const seen = new Set();
    const finalLines = [];

    const addRawLine = (raw, maybeTitle, maybeArtist) => {
      const key = canonicalKey(maybeTitle || raw, maybeArtist || '');
      if (seen.has(key)) return false;
      seen.add(key);
      finalLines.push(raw);
      return true;
    };

    // 1) add seeds EXACTLY as user provided (ensures presence and order)
    for (const seedStr of seedsRaw) {
      const p = parseLineToPair(seedStr);
      if (p && p.title) addRawLine(`${p.title} - ${p.artist || ''}`, p.title, p.artist || '');
      else addRawLine(seedStr, seedStr, '');
    }

    // 2) call Claude (and possibly follow up) until we have TARGET_TOTAL or retries exhausted
    let attempt = 0;
    let userMessages = [initialUser];

    while (finalLines.length < TARGET_TOTAL && attempt <= MAX_RETRIES) {
      attempt++;
      console.log(`playlist-claude: calling Claude, attempt ${attempt}. Need ${Math.max(0, TARGET_TOTAL - finalLines.length)} more items.`);
      const text = await callClaude(userMessages);
      const suggestedLines = linesFromText(text);
      console.log('playlist-claude: claude returned lines count:', suggestedLines.length);

      // parse and add suggestions
      for (const l of suggestedLines) {
        if (finalLines.length >= MAX_TOTAL) break;
        const p = parseLineToPair(l);
        if (p && p.title) addRawLine(`${p.title} - ${p.artist || ''}`, p.title, p.artist || '');
        else addRawLine(l, l, '');
      }

      // if we reached target or cap, break
      if (finalLines.length >= TARGET_TOTAL || finalLines.length >= MAX_TOTAL) break;

      // prepare a follow-up user message requesting only the missing amount, excluding already-used entries
      const missing = Math.min(TARGET_TOTAL - finalLines.length, MAX_TOTAL - finalLines.length);
      const excludeList = Array.from(seen).slice(0, 200).map(k => {
        // we stored keys as "title|||artist"
        const parts = k.split('|||');
        return parts[0] + (parts[1] ? ` - ${parts[1]}` : '');
      });
      const followUpContent = `Please provide ${missing} additional unique songs in the same "Title - Artist" format, similar genre/vibe, and do NOT repeat any of these songs (exclude):\n${excludeList.join('\n')}\nReturn only plain lines "Title - Artist".`;
      // next request ask only for suggestions
      userMessages = [{ role: 'user', content: followUpContent }];
    }

    // final safety: ensure seeds still present (should be)
    for (const seedStr of seedsRaw) {
      const p = parseLineToPair(seedStr);
      const key = canonicalKey(p ? p.title : seedStr, p ? p.artist : '');
      if (!seen.has(key)) {
        finalLines.unshift(p ? `${p.title} - ${p.artist || ''}` : seedStr);
        seen.add(key);
      }
    }

    // Build result text; limit to MAX_TOTAL
    const finalTextLines = finalLines.slice(0, MAX_TOTAL);
    console.log('playlist-claude: returning final count:', finalTextLines.length);

    const playlistText = finalTextLines.join('\n');

    // if, after retries, we still didn't reach TARGET_TOTAL, return with a warning field so client can show notice
    const success = finalTextLines.length >= TARGET_TOTAL;
    const warning = success ? null : `Only ${finalTextLines.length} items could be generated (requested ${TARGET_TOTAL}).`;

    return res.status(200).json({ playlistText, count: finalTextLines.length, success, warning });
  } catch (err) {
    console.error('playlist-claude error:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}
