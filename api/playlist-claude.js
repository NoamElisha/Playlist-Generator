// api/playlist-claude.js
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { seeds } = req.body;

    if (!seeds || !Array.isArray(seeds)) {
      return res.status(400).json({ error: "You must provide an array of songs." });
    }

    // --- Validation rules ---
    if (seeds.length < 5) {
      return res.status(400).json({ error: "Please provide at least 5 seed songs." });
    }
    if (seeds.length > 12) {
      return res.status(400).json({ error: "You can provide at most 12 seed songs." });
    }

    // כל שיר חייב להיות מאמן אחר
    const artists = seeds.map((s) => s.split("-").slice(1).join("-").trim().toLowerCase());
    if (new Set(artists).size < seeds.length) {
      return res.status(400).json({ error: "All seed songs must be from different artists." });
    }

    // --- Target playlist length rules ---
    let targetTotal;
    if (seeds.length >= 8) {
      targetTotal = Math.floor(Math.random() * (50 - 30 + 1)) + 30; // 30–50
    } else {
      targetTotal = Math.floor(Math.random() * (40 - 20 + 1)) + 20; // 20–40
    }

    // --- Build user prompt ---
    const userPrompt = `
The user provided these seed songs (Title - Artist):
${seeds.join(" | ")}

RULES:
1. Use EXACTLY the same artists as in the seed list. Do not add new artists.
2. Always include the seed songs in the final playlist.
3. The final playlist must contain ${targetTotal} songs in total.
4. All songs must be real, existing songs by those artists only.
5. Strict format: Title - Artist (one per line, no numbering, no extra text).
6. If seeds are mostly Hebrew: only Hebrew songs by Israeli artists.
   If seeds are mostly English: only international English-language songs.
7. No duplicates. Each artist must appear with multiple different songs.
    `;

    const response = await client.messages.create({
      model: "claude-3-sonnet-20240229",
      max_tokens: 1500,
      system: "You are a playlist generator. Follow the rules strictly.",
      messages: [{ role: "user", content: userPrompt }],
    });

    const output = response.content
      .map((block) => block.text)
      .join("\n")
      .trim();

    res.status(200).json({
      playlist: output,
      requestedSongs: seeds.length,
      targetTotal,
    });
  } catch (error) {
    console.error("playlist-claude error:", error);
    res.status(500).json({ error: error.message });
  }
}
