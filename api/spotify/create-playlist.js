// api/spotify/create-playlist.js
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(pair => {
    const [k, ...v] = pair.split('=');
    cookies[k?.trim()] = decodeURIComponent(v.join('=').trim());
  });
  return cookies;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Try Authorization header first
  const authHeader = req.headers['authorization'];
  let accessToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  // fallback: parse cookie header
  if (!accessToken) {
    const cookies = parseCookies(req.headers?.cookie || '');
    accessToken = cookies.spotify_access_token || null;
  }

  console.log('create-playlist: accessToken present?', !!accessToken);

  if (!accessToken) return res.status(401).json({ error: 'Not authenticated with Spotify (no access token)' });

  const { name = 'My AI Playlist', tracks } = req.body;
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).json({ error: 'Missing tracks array' });
  }

  try {
    // 1) get current user
    let r = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error('create-playlist: /me failed', r.status, txt);
      return res.status(r.status).send(txt);
    }
    const me = await r.json();
    const userId = me.id;

    // 2) create playlist
    r = await fetch(`https://api.spotify.com/v1/users/${encodeURIComponent(userId)}/playlists`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: 'Playlist created by AI', public: false })
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error('create-playlist: create playlist failed', r.status, txt);
      return res.status(r.status).send(txt);
    }
    const pl = await r.json();
    const playlistId = pl.id;

    // 3) search tracks and collect URIs
    const uris = [];
    for (const t of tracks) {
      const qParts = [];
      if (t.title) qParts.push(`track:${t.title}`);
      if (t.artist) qParts.push(`artist:${t.artist}`);
      const q = encodeURIComponent(qParts.join(' '));
      const searchUrl = `https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`;
      const sres = await fetch(searchUrl, { headers: { Authorization: `Bearer ${accessToken}` }});
      if (!sres.ok) {
        console.warn('search failed for', t, sres.status);
        continue;
      }
      const sdata = await sres.json();
      const uri = sdata?.tracks?.items?.[0]?.uri;
      if (uri) uris.push(uri);
    }

    // 4) add tracks in batches
    for (let i = 0; i < uris.length; i += 100) {
      const batch = uris.slice(i, i+100);
      await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: batch })
      });
    }

    console.log('create-playlist: finished, added', uris.length);
    return res.status(200).json({ playlistUrl: pl.external_urls.spotify, added: uris.length, totalFound: uris.length });

  } catch (err) {
    console.error('spotify create playlist error', err);
    return res.status(500).json({ error: err.message });
  }
}