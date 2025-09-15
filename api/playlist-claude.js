// api/playlist-claude.js
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function isHebrewText(s) {
  return /[\u0590-\u05FF]/.test(s);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { songs } = req.body;

    if (!Array.isArray(songs) || songs.length === 0)
      return res.status(400).json({ error: "You must provide an array of songs." });

    if (songs.length < 5) return res.status(400).json({ error: "Please provide at least 5 seed songs." });
    if (songs.length > 12) return res.status(400).json({ error: "You can provide at most 12 seed songs." });

    const hebrewCount = songs.filter(isHebrewText).length;
    const preferHebrew = hebrewCount >= Math.ceil(songs.length / 2);

    // target playlist size
    const targetTotal = songs.length >= 8
      ? Math.floor(Math.random() * (50 - 30 + 1)) + 30
      : Math.floor(Math.random() * (40 - 20 + 1)) + 20;

    const userPrompt = `
User provided these seed songs (Title - Artist):
${songs.join(" | ")}

RULES:
1. Always include the seed songs.
2. Target total songs: ${targetTotal}.
3. Use only the same artists as seeds.
4. Return only real songs by these artists.
5. Strict format: Title - Artist (one per line, no numbering, no extra text).
6. No duplicates.
7. If seeds are mostly Hebrew: only Hebrew songs by Israeli artists.
   If seeds are mostly English: only international English-language songs.
    `;

    const response = await client.messages.create({
      model: "claude-3", // עדכני
      max_tokens: 1500,
      system: "You are a playlist generator. Follow the rules strictly.",
      messages: [{ role: "user", content: userPrompt }],
    });

    // response.content יכול להיות array של block objects
    const output = response.content
      .map(block => block.text)
      .join("\n")
      .trim();

    res.status(200).json({ playlist: output, requestedSongs: songs.length, targetTotal });
  } catch (error) {
    console.error("playlist-claude error:", error);
    res.status(500).json({ error: error.message });
  }
}
