
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(pair => {
    const [k, ...v] = pair.split('=');
    cookies[k?.trim()] = decodeURIComponent(v.join('=').trim());
  });
  return cookies;
}

async function refreshAccessToken(refreshToken) {
  const client_id = process.env.SPOTIFY_CLIENT_ID;
  const client_secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!refreshToken) throw new Error('No refresh token');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id,
    client_secret
  });

  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  const j = await r.json();
  if (!r.ok) {
    throw new Error('Spotify refresh failed: ' + JSON.stringify(j));
  }
  return j; 
}

function cookieStringsFromTokens({ access_token, refresh_token }) {
  const isProd = process.env.NODE_ENV === 'production';
  const baseCookie = 'HttpOnly; Path=/; SameSite=Lax';
  const cookies = [];
  if (access_token) {
    cookies.push(`spotify_access_token=${access_token}; ${baseCookie}; Max-Age=3600${isProd ? '; Secure' : ''}`);
  }
  if (refresh_token) {
    cookies.push(`spotify_refresh_token=${refresh_token}; ${baseCookie}; Max-Age=${60*60*24*30}${isProd ? '; Secure' : ''}`);
  }
  return cookies;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });


  const authHeader = req.headers['authorization'];
  let accessToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;


  const cookies = parseCookies(req.headers?.cookie || '');
  let refreshToken = cookies.spotify_refresh_token || null;
  if (!accessToken) {
    accessToken = cookies.spotify_access_token || null;
  }

  console.log('create-playlist: accessToken present?', !!accessToken, 'refresh present?', !!refreshToken);

  const { name = 'My AI Playlist', tracks } = req.body;
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).json({ error: 'Missing tracks array' });
  }

  async function ensureUserToken() {
    
    let r = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (r.status === 401 || r.status === 403) {
      if (!refreshToken) {
        return { ok: false, status: 401, body: 'Not authenticated with Spotify (no valid token)' };
      }
      try {
        const refreshed = await refreshAccessToken(refreshToken);
        accessToken = refreshed.access_token;
        
        if (refreshed.refresh_token) refreshToken = refreshed.refresh_token;

 
        const setCookies = cookieStringsFromTokens(refreshed);
        if (setCookies.length) res.setHeader('Set-Cookie', setCookies);

   
        r = await fetch('https://api.spotify.com/v1/me', {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
      } catch (err) {
        console.error('refreshAccessToken failed:', err);
        return { ok: false, status: 401, body: 'Spotify session expired. Please log in again.' };
      }
    }

    if (!r.ok) {
      const txt = await r.text();
      console.error('create-playlist: /me failed', r.status, txt);
      return { ok: false, status: r.status, body: txt };
    }

    const me = await r.json();
    return { ok: true, me };
  }

  try {
    const ensured = await ensureUserToken();
    if (!ensured.ok) {
      if (ensured.status === 401) {
        return res.status(401).json({ error: ensured.body });
      }
      return res.status(ensured.status || 500).send(ensured.body || 'Spotify /me failed');
    }
    const userId = ensured.me.id;

    let r = await fetch(`https://api.spotify.com/v1/users/${encodeURIComponent(userId)}/playlists`, {
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


    for (let i = 0; i < uris.length; i += 100) {
      const batch = uris.slice(i, i+100);
      await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: batch })
      });
    }

    console.log('create-playlist: finished, added', uris.length);
    return res.status(200).json({
      playlistUrl: pl.external_urls.spotify,
      added: uris.length,
      totalFound: uris.length,
      message: 'Playlist created and tracks added'
    });

  } catch (err) {
    console.error('spotify create playlist error', err);
    return res.status(500).json({ error: err.message });
  }
}
