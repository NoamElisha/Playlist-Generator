// /api/playlist-claude.js
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-3-haiku-20240307"; // <<< מודל תקין
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function splitLines(text) {
  return (text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}
function parseLineToPair(line) {
  const parts = line.split(/[-–—]/).map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const title = parts[0].replace(/^["“”']+|["“”']+$/g, "");
    const artist = parts.slice(1).join("-").replace(/^["“”']+|["“”']+$/g, "");
    if (title && artist) return { title, artist };
  }
  return null;
}
function canonicalKey(t, a) {
  return `${(t || "").trim().toLowerCase()}|||${(a || "").trim().toLowerCase()}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { songs } = req.body ?? {};
    if (!Array.isArray(songs)) {
      return res.status(400).json({ error: "נא להזין מערך שירים בפורמט Title - Artist" });
    }

    // ננקה קלט
    const seedsRaw = songs.map(s => (typeof s === "string" ? s.trim() : "")).filter(Boolean);

    // 5–12 שירים
    if (seedsRaw.length < 5 || seedsRaw.length > 12) {
      return res.status(400).json({ error: "יש להזין בין 5 ל-12 שירים (בפורמט: Title - Artist)." });
    }

    // חילוץ אמנים ודרישה ל-5 אמנים שונים לפחות
    const seedPairs = seedsRaw.map(parseLineToPair).filter(Boolean);
    const artistSet = new Set(seedPairs.map(p => p.artist).filter(Boolean).map(a => a.toLowerCase().trim()));
    if (artistSet.size < 5) {
      return res.status(400).json({
        error: "יש צורך בלפחות 5 זמרים/אמנים שונים ברשימת השירים שהזנת. הוסף אמנים נוספים ונסה שוב."
      });
    }

    // יעד אורך רנדומלי בהתאם לכמות הסידס
    const targetTotal = seedsRaw.length <= 7 ? randInt(25, 40) : randInt(35, 50);

    const allowedArtistsList = Array.from(artistSet).join(", ");

    const system = `You are a strict playlist generator.
- Output ONLY newline-separated lines in the exact format: Title - Artist
- Use ONLY these artists (no new artists allowed): ${allowedArtistsList}
- Include the seed songs too.
- No commentary, no numbering, no explanations.
- No duplicates.`;

    const user = `Seed songs (exact format "Title - Artist"):
${seedsRaw.join("\n")}

Rules:
- Total target lines: ${targetTotal}
- Use ONLY the same artists that appear in the seeds.
- Prefer a nice mix across these artists.
- Return ONLY the lines, no extra text.`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: user }],
    });

    const blocks = Array.isArray(response?.content) ? response.content : [];
    const rawText = blocks.map(b => b?.text || "").join("\n").trim();

    // פוסט־פרוסס קפדני: מכניסים קודם את הסידס, אחר כך רק שירים של אותם אמנים, בלי כפילויות
    const seen = new Set();
    const out = [];

    // 1) סידס - תמיד בפנים וללא כפילויות
    for (const raw of seedsRaw) {
      const p = parseLineToPair(raw);
      if (!p) continue;
      const key = canonicalKey(p.title, p.artist);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(`${p.title} - ${p.artist}`);
      }
    }

    // 2) הצעות המודל - רק אמנים מורשים, עד כמות היעד
    const suggestions = splitLines(rawText);
    for (const line of suggestions) {
      if (out.length >= 80) break; // הגבלת בטיחות
      const p = parseLineToPair(line);
      if (!p || !p.artist) continue;
      if (!artistSet.has(p.artist.toLowerCase().trim())) continue; // רק אמנים מהסידס
      const key = canonicalKey(p.title, p.artist);
      if (seen.has(key)) continue;
      out.push(`${p.title} - ${p.artist}`);
      seen.add(key);
      if (out.length >= targetTotal) break;
    }

    let warning = null;
    if (out.length < targetTotal) {
      warning = `הופקו ${out.length} שירים בלבד (היעד היה ${targetTotal}).`;
    }

    return res.status(200).json({
      playlistText: out.join("\n"), // <<< שם אחיד שהקליינט מצפה לו
      count: out.length,
      targetTotal,
      success: out.length >= 5,
      warning,
    });
  } catch (error) {
    console.error("playlist-claude error:", error);
    return res.status(500).json({ error: error?.message || String(error) });
  }
}
