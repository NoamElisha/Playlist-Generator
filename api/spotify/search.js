// /api/spotify/search.js
// Proxy מאובטח לאוטוקומפליט: artist/track
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
    const q = (req.query.q || "").toString().trim();
    const type = (req.query.type || "artist,track").toString(); // artist | track | artist,track
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "8", 10), 12));
    const market = (req.query.market || SPOTIFY_MARKET).toString();

    if (!q || q.length < 2) {
      return res.status(200).json({ artists: [], tracks: [] });
    }

    const { token, error, status } = await getSpotifyAppToken();
    if (error) return res.status(status || 500).json({ error });

    const url = new URL("https://api.spotify.com/v1/search");
    url.searchParams.set("q", q);
    url.searchParams.set("type", type);
    url.searchParams.set("limit", String(limit));
    if (market) url.searchParams.set("market", market);

    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    // ננרמל תשובה קטנה, קומפקטית ללקוח
    const artists = (data.artists?.items || []).map(a => ({
      id: a.id,
      name: a.name,
      image: a.images?.[a.images.length - 1]?.url || a.images?.[0]?.url || null
    }));

    const tracks = (data.tracks?.items || []).map(t => ({
      id: t.id,
      name: t.name,
      artist: t.artists?.[0]?.name || "",
      image: t.album?.images?.[t.album.images.length - 1]?.url || t.album?.images?.[0]?.url || null
    }));

    // Cache קצר להרגשה מהירה (דפדפן): 30 שניות
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    return res.status(200).json({ artists, tracks });
  } catch (e) {
    console.error("spotify search error:", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
