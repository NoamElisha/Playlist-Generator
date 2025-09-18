
export default function handler(req, res) {
  const client_id = process.env.SPOTIFY_CLIENT_ID;
  const redirect_uri = process.env.SPOTIFY_REDIRECT_URI;
  const scope = [
    'playlist-modify-public',
    'playlist-modify-private',
    'user-read-private',
    'user-read-email'
  ].join(' ');
  const state = Math.random().toString(36).slice(2);

  const url = new URL('https://accounts.spotify.com/authorize');
  url.searchParams.set('client_id', client_id);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirect_uri);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  res.writeHead(302, { Location: url.toString() });
  res.end();
}
