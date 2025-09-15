// /api/playlist-claude.js
const SPOTIFY_MARKET = process.env.SPOTIFY_MARKET || "IL"; // אפשר לשנות ל-US וכו'
const TARGET_MIN = 20; // מינימום קשיח

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function shuffle(arr){ for (let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }

function splitLines(text){ return (text||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean); }
function parseLineToPair(line){
  const parts = (line||"").split(/[-–—]/).map(s=>s.trim()).filter(Boolean);
  if (parts.length>=2){
    const title  = parts[0].replace(/^["“”']+|["“”']+$/g,"");
    const artist = parts.slice(1).join("-").replace(/^["“”']+|["“”']+$/g,"");
    if (title && artist) return { title, artist };
  }
  return null;
}
function canonicalKey(t,a){ return `${(t||"").toLowerCase().trim()}|||${(a||"").toLowerCase().trim()}`; }

async function getSpotifyAppToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Missing SPOTIFY_CLIENT_ID/SECRET");
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded","Authorization":`Basic ${basic}`},
    body:"grant_type=client_credentials"
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Spotify token failed: " + JSON.stringify(j));
  return j.access_token;
}

// חיפוש גמיש לשיר בודד — מנסה כמה דפוסים כולל היפוך Title/Artist
async function searchTrackFlexible(token, title, artist, market=SPOTIFY_MARKET){
  const queries = [
    `track:"${title}" artist:"${artist}"`,
    `track:"${artist}" artist:"${title}"`,
    `"${title}" "${artist}"`,
    `${title} ${artist}`
  ];
  for (const q of queries){
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=5${market?`&market=${market}`:""}`;
    const r = await fetch(url,{ headers:{ Authorization:`Bearer ${token}` }});
    if (!r.ok) continue;
    const items = (await r.json())?.tracks?.items || [];
    if (items.length){
      // העדף התאמה לפי שם האמן אם קיים
      const hit = items.find(it => it.artists?.some(a => a.name.toLowerCase() === artist.toLowerCase()))
               || items[0];
      if (hit) return hit;
    }
  }
  return null;
}

// מחזיר {title, artist} נורמליים מהסידס, לפי שמות רשמיים של Spotify
async function normalizeSeed(token, raw){
  const p = parseLineToPair(raw);
  if (p){
    const tr = await searchTrackFlexible(token, p.title, p.artist);
    if (tr){
      const primary = tr.artists?.[0]?.name || p.artist;
      const name = tr.name || p.title;
      return { title: name, artist: primary };
    }
  }
  // ניסיון פשטני אם אין פיצול:
  const q = raw.replace(/[-–—]/g," ");
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=5${SPOTIFY_MARKET?`&market=${SPOTIFY_MARKET}`:""}`;
  const r = await fetch(url,{ headers:{ Authorization:`Bearer ${token}` }});
  if (r.ok){
    const it = (await r.json())?.tracks?.items?.[0];
    if (it) return { title: it.name, artist: it.artists?.[0]?.name || "" };
  }
  return null;
}

// שליפת הרבה טראקים לאמן ע"י חיפוש tracks על שם האמן (מהיר, 50 תוצאות)
async function fetchArtistTracks(token, artistName, market=SPOTIFY_MARKET){
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(`artist:"${artistName}"`)}&type=track&limit=50${market?`&market=${market}`:""}`;
  const r = await fetch(url,{ headers:{ Authorization:`Bearer ${token}` }});
  if (!r.ok) return [];
  const items = (await r.json())?.tracks?.items || [];
  // נשמור רק טראקים שהאמן הראשי שלהם הוא האמן המבוקש (כדי להימנע מפיצ'רים לא רלוונטיים)
  return items
    .filter(t => (t.artists?.[0]?.name || "").toLowerCase().trim() === artistName.toLowerCase().trim())
    .sort((a,b) => (b.popularity||0) - (a.popularity||0)); // פופולריים ראשונים
}

export default async function handler(req,res){
  if (req.method !== "POST") return res.status(405).json({ error:"Method not allowed" });
  try{
    const { songs } = req.body ?? {};
    if (!Array.isArray(songs)) return res.status(400).json({ error:"נא להזין מערך שירים בפורמט Title - Artist" });

    const seedsRaw = songs.map(s => (typeof s === "string" ? s.trim() : "")).filter(Boolean);

    // 5–12 שירים
    if (seedsRaw.length < 5 || seedsRaw.length > 12) {
      return res.status(400).json({ error: "יש להזין בין 5 ל-12 שירים (בפורמט: Title - Artist)." });
    }

    const token = await getSpotifyAppToken();

    // ננרמל את הסידס לפי ספוטיפיי (מתקן גם Artist/Title הפוכים)
    const normalizedSeeds = [];
    const allowedArtists = new Set();
    for (const raw of seedsRaw){
      const norm = await normalizeSeed(token, raw);
      if (norm && norm.title && norm.artist){
        normalizedSeeds.push(`${norm.title} - ${norm.artist}`);
        allowedArtists.add(norm.artist.toLowerCase().trim());
      }
    }

    // חייבים לפחות 5 אמנים שונים
    if (allowedArtists.size < 5) {
      return res.status(400).json({ error: "יש צורך בלפחות 5 זמרים/אמנים שונים ברשימת השירים. ודא שהפורמט הוא Title - Artist ושמדובר בשירים קיימים." });
    }

    // יעד לפי מספר הסידס (עם מינימום קשיח)
    const targetSoft = seedsRaw.length <= 7 ? randInt(25,40) : randInt(35,50);
    const targetTotal = Math.max(targetSoft, TARGET_MIN);

    // אוסף מועמדים: קודם כל הסידס, אח״כ טראקים של כל אמן מספוטיפיי
    const seen = new Set();
    const candidates = [];

    // סידס קודם – עם ניקוי כפילויות
    for (const s of normalizedSeeds){
      const [t,a] = splitLines(s)[0].split(" - ");
      const key = canonicalKey(t,a);
      if (!seen.has(key)){
        seen.add(key);
        candidates.push(s);
      }
    }

    // הוסף טראקים לכל אמן עד שיש די (ניקח פופולרי, נערבב בסוף)
    for (const artistLower of allowedArtists){
      const artistName = [...allowedArtists].find(a => a === artistLower); // lowercase already
      // אבל לשם התצוגה נחפש את הקייס האמיתי מתוך הסידס הנורמליים
      const displayName = normalizedSeeds
        .map(s => s.split(" - ")[1])
        .find(a => a.toLowerCase().trim() === artistLower) || artistLower;

      const tracks = await fetchArtistTracks(token, displayName);
      for (const tr of tracks){
        const title = tr.name;
        const primary = tr.artists?.[0]?.name || displayName;
        const key = canonicalKey(title, primary);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(`${title} - ${primary}`);
        if (candidates.length >= targetTotal + 30) break; // בופר קטן לפני ערבוב/חיתוך
      }
      if (candidates.length >= targetTotal + 30) break;
    }

    // ערבוב, הקפד שהסידס ישארו בפנים (הם כבר בפנים בהתחלה)
    const seedsCount = normalizedSeeds.length;
    const rest = shuffle(candidates.slice(seedsCount));
    const final = candidates.slice(0,seedsCount).concat(rest).slice(0, targetTotal);

    return res.status(200).json({
      playlistText: final.join("\n"),
      count: final.length,
      targetTotal
    });

  } catch (e){
    console.error("playlist build error:", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
