
export default async function handler(req, res) {
  try {
    const { code, error } = req.query;
    if (error) {
      console.error('spotify callback error param:', error);
      return res.status(400).send('Spotify callback error: ' + error);
    }
    if (!code) return res.status(400).send('Missing code');

    const client_id = process.env.SPOTIFY_CLIENT_ID;
    const client_secret = process.env.SPOTIFY_CLIENT_SECRET;
    const redirect_uri = process.env.SPOTIFY_REDIRECT_URI;

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri,
      client_id,
      client_secret
    });

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });

    const data = await tokenRes.json();
    console.log('spotify callback: token response status', tokenRes.status, 'body:', data);

    if (!tokenRes.ok) {
      console.error('spotify token error', data);
      return res.status(500).send('Spotify token exchange failed. Check logs.');
    }

    const isProd = process.env.NODE_ENV === 'production';
    const baseCookie = 'HttpOnly; Path=/; SameSite=Lax';
    const accessCookie = `${baseCookie}; Max-Age=3600${isProd ? '; Secure' : ''}`;
    const refreshCookie = `${baseCookie}; Max-Age=${60*60*24*30}${isProd ? '; Secure' : ''}`;

    res.setHeader('Set-Cookie', [
      `spotify_access_token=${data.access_token}; ${accessCookie}`,
      `spotify_refresh_token=${data.refresh_token}; ${refreshCookie}`
    ]);

    const redirectTo = '/?spotify=connected';
    res.writeHead(302, { Location: redirectTo });
    res.end();

  } catch (err) {
    console.error('spotify callback exception:', err);
    return res.status(500).send('Internal server error');
  }
}
