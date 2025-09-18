
const SPOTIFY_MARKET = process.env.SPOTIFY_MARKET || "IL";

async function getSpotifyAppToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    return { error: "Missing SPOTIFY_CLIENT_ID/SECRET", status: 500 };
  }
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basic}`
    },
    body: "grant_type=client_credentials"
  });
  const j = await r.json();
  if (!r.ok) return { error: "Spotify token failed: " + JSON.stringify(j), status: 500 };
  return { token: j.access_token };
}

export default async function handler(req, res) {
  try {
    const id = (req.query.id || "").toString().trim();
    const market = (req.query.market || SPOTIFY_MARKET).toString();
    if (!id) return res.status(400).json({ error: "Missing artist id" });

    const { token, error, status } = await getSpotifyAppToken();
    if (error) return res.status(status || 500).json({ error });

    const url = `https://api.spotify.com/v1/artists/${id}/top-tracks?market=${encodeURIComponent(market)}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    const tracks = (data.tracks || []).map(t => ({
      id: t.id,
      name: t.name,
      artist: t.artists?.[0]?.name || "",
      image: t.album?.images?.[t.album.images.length - 1]?.url || t.album?.images?.[0]?.url || null
    }));

    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=60");
    return res.status(200).json({ tracks });
  } catch (e) {
    console.error("artist top-tracks error:", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
