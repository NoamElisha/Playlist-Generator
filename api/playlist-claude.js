// /api/playlist-claude.js
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-3-haiku-20240307";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SPOTIFY_MARKET = process.env.SPOTIFY_MARKET || "IL"; // אפשר להחליף ל-"US" וכו'

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function splitLines(text) { return (text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean); }
function parseLineToPair(line) {
  const parts = line.split(/[-–—]/).map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const title = parts[0].replace(/^["“”']+|["“”']+$/g, "");
    const artist = parts.slice(1).join("-").replace(/^["“”']+|["“”']+$/g, "");
    if (title && artist) return { title, artist };
  }
  return null;
}
function canonicalKey(t, a) { return `${(t||"").trim().toLowerCase()}|||${(a||"").trim().toLowerCase()}`; }

async function getSpotifyAppToken() {
  const client_id = process.env.SPOTIFY_CLIENT_ID;
  const client_secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!client_id || !client_secret) throw new Error("Missing SPOTIFY_CLIENT_ID/SECRET env vars");

  const basic = Buffer.from(`${client_id}:${client_secret}`).toString("base64");
  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basic}`
    },
    body: "grant_type=client_credentials"
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error("Spotify app token failed: " + JSON.stringify(json));
  return json.access_token;
}

async function verifyLinesOnSpotify(lines, market = SPOTIFY_MARKET) {
  const token = await getSpotifyAppToken();
  const verified = [];
  for (const line of lines) {
    const p = parseLineToPair(line);
    if (!p) continue;
    // חיפוש קפדני: track:"Title" artist:"Artist"
    const q = encodeURIComponent(`track:"${p.title}" artist:"${p.artist}"`);
    const url = `https://api.spotify.com/v1/search?q=${q}&type=track&limit=1${market ? `&market=${market}` : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) continue;
    const data = await r.json();
    const found = data?.tracks?.items?.[0];
    if (found) {
      verified.push(`${p.title} - ${p.artist}`); // משאירים את הטקסט המקורי לתצוגה
    }
  }
  return verified;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { songs } = req.body ?? {};
    if (!Array.isArray(songs)) return res.status(400).json({ error: "נא להזין מערך שירים בפורמט Title - Artist" });

    const seedsRaw = songs.map(s => (typeof s === "string" ? s.trim() : "")).filter(Boolean);

    // 5–12 שירים
    if (seedsRaw.length < 5 || seedsRaw.length > 12) {
      return res.status(400).json({ error: "יש להזין בין 5 ל-12 שירים (בפורמט: Title - Artist)." });
    }

    // אמנים שונים >= 5
    const seedPairs = seedsRaw.map(parseLineToPair).filter(Boolean);
    const artistSet = new Set(seedPairs.map(p => p.artist).filter(Boolean).map(a => a.toLowerCase().trim()));
    if (artistSet.size < 5) {
      return res.status(400).json({
        error: "יש צורך בלפחות 5 זמרים/אמנים שונים ברשימת השירים שהזנת. הוסף אמנים נוספים ונסה שוב."
      });
    }

    // יעד רנדומלי
    const targetTotal = seedsRaw.length <= 7 ? randInt(25, 40) : randInt(35, 50);
    const allowedArtistsList = Array.from(artistSet).join(", ");

    // 🧠 הנחיות קשוחות למודל: לא להמציא, רק שירים קיימים, מותר פחות מהיעד
    const system = `You are a strict playlist generator.
- Output ONLY newline-separated lines exactly as: Title - Artist
- Use ONLY these artists (no new artists): ${allowedArtistsList}
- Include the seed songs too.
- Do NOT invent songs, aliases, or unreleased tracks.
- Return ONLY songs that EXIST on Spotify TODAY. If you are not 100% sure a song exists, OMIT it.
- It is acceptable to return FEWER than the target count.
- No commentary, no numbering, no explanations, no duplicates.`;

    const user = `Seed songs (Title - Artist):
${seedsRaw.join("\n")}

Rules:
- Target count (soft): ${targetTotal}
- Use ONLY artists from the seeds.
- Prefer a good mix across these artists.
- Return ONLY the lines, no extra text.`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: user }],
    });

    const blocks = Array.isArray(response?.content) ? response.content : [];
    const rawText = blocks.map(b => b?.text || "").join("\n").trim();

    // נבנה רשימת מועמדים: קודם הסידס, אחר כך ההצעות (מסוננות לאמנים מורשים וללא כפילויות)
    const seen = new Set();
    const candidates = [];

    // הוספת הסידס (כמועמדים—נבדוק מול ספוטיפיי עוד רגע)
    for (const raw of seedsRaw) {
      const p = parseLineToPair(raw);
      if (!p) continue;
      const key = canonicalKey(p.title, p.artist);
      if (!seen.has(key)) { seen.add(key); candidates.push(`${p.title} - ${p.artist}`); }
    }

    // הוספת ההצעות של המודל (רק אמנים מורשים)
    const suggestions = splitLines(rawText);
    for (const line of suggestions) {
      const p = parseLineToPair(line);
      if (!p || !p.artist) continue;
      if (!artistSet.has(p.artist.toLowerCase().trim())) continue;
      const key = canonicalKey(p.title, p.artist);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(`${p.title} - ${p.artist}`);
    }

    // ✅ אימות מול Spotify: נשאיר רק מה שבאמת קיים
    const verified = await verifyLinesOnSpotify(candidates, SPOTIFY_MARKET);

    // נחזיר בלי אזהרות—פשוט פחות שירים אם לא נמצאו מספיק
    return res.status(200).json({
      playlistText: verified.slice(0, targetTotal).join("\n"),
      count: Math.min(verified.length, targetTotal),
      targetTotal
    });
  } catch (error) {
    console.error("playlist-claude error:", error);
    return res.status(500).json({ error: error?.message || String(error) });
  }
}
