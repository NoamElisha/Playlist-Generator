// api/playlist-claude.js

const SYSTEM_PROMPT = `
You are an assistant that receives a list of 5 songs (title and optionally artist) and suggests 10-15 additional songs
that are musically similar (same vibe/genre/mood). Return ONLY a plain list of songs, each on its own line, with "Title - Artist".
Do NOT include numbering, explanation, or anything else.
`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // read and normalize input
    const { songs } = req.body ?? {};
    console.log('playlist-claude: received raw body:', req.body);
    console.log('playlist-claude: received songs:', songs);

    if (!songs || !Array.isArray(songs)) {
      return res.status(400).json({ error: 'Please provide an array of songs.' });
    }

    // keep only non-empty string entries and trim
    const cleanedSongs = songs
      .map(s => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean);

    if (cleanedSongs.length < 5) {
      return res.status(400).json({ error: 'Please provide an array of at least 5 songs.' });
    }

    // Build Anthropic request
    const promptUser = `Here are some songs I like: ${cleanedSongs.join(' | ')}. Suggest 10–15 additional songs in the same vibe. Return only lines like: Title - Artist`;

    console.log('playlist-claude: sending to Anthropic, user prompt:', promptUser);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
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
        messages: [
          { role: 'user', content: promptUser }
        ]
      })
    });

    if (!response.ok) {
      const txt = await response.text();
      console.error('playlist-claude: Anthropic returned non-OK status', response.status, txt);
      return res.status(response.status).send(txt);
    }

    const data = await response.json();
    console.log('playlist-claude: Claude raw response:', JSON.stringify(data, null, 2));

    // Try multiple common places for the text (Claude responses vary)
    let text = '';

    // most common in your earlier logs:
    if (data?.content?.[0]?.text) {
      text = data.content[0].text;
    }
    // fallback: direct completion string
    else if (typeof data.completion === 'string' && data.completion.trim()) {
      text = data.completion;
    }
    // fallback: completion.parts (array of strings)
    else if (Array.isArray(data.completion?.parts)) {
      text = data.completion.parts.join('');
    }
    // fallback: messages array (map text/content)
    else if (Array.isArray(data.messages) && data.messages.length) {
      text = data.messages.map(m => m.text || m.content || '').join('\n');
    }
    // final fallback: entire object as string
    else {
      text = JSON.stringify(data);
    }

    const playlistText = (text || "Claude didn't return a playlist.").toString().trim();

    console.log('playlist-claude: final playlistText (trimmed):', playlistText.substring(0, 1000)); // log up to 1000 chars

    return res.status(200).json({ playlistText });
  } catch (err) {
    console.error('playlist-claude error:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}
