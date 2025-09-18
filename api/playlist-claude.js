// /api/playlist-claude.js
const SPOTIFY_MARKET = process.env.SPOTIFY_MARKET || "IL"; // אפשר לשנות ל-US וכו'
const TARGET_MIN = 20; // מינימום קשיח
const MAX_CONSEC = 2;  // לא יותר מ-2 שירים רצופים מאותו אמן (נרפה רק אם תקוע)

function keyFromLine(line){
  const p = parseLineToPair(line);
  return p ? canonicalKey(p.title, p.artist) : (line||"").toLowerCase().trim();
}

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
      const hit = items.find(it => it.artists?.some(a => a.name.toLowerCase() === artist.toLowerCase()))
               || items[0];
      if (hit) return hit;
    }
  }
  return null;
}

// נרמול סיד—להוציא משמות רשמיים של ספוטיפיי (מתקן גם Artist/Title הפוכים)
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
  // ניסיון פשטני אם אין פיצול ברור:
  const q = raw.replace(/[-–—]/g," ");
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=5${SPOTIFY_MARKET?`&market=${SPOTIFY_MARKET}`:""}`;
  const r = await fetch(url,{ headers:{ Authorization:`Bearer ${token}` }});
  if (r.ok){
    const it = (await r.json())?.tracks?.items?.[0];
    if (it) return { title: it.name, artist: it.artists?.[0]?.name || "" };
  }
  return null;
}

// קבלת רשימת טראקים עשירה לאמן: גם top-tracks (אם קיים id), גם חיפוש track לפי artist
async function fetchArtistTracks(token, artistName, market=SPOTIFY_MARKET){
  let artistId = null;
  // קודם חפש entity של האמן כדי לנסות להביא top-tracks
  try {
    const aUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(artistName)}&type=artist&limit=3`;
    const ar = await fetch(aUrl, { headers:{ Authorization:`Bearer ${token}` }});
    if (ar.ok){
      const artists = (await ar.json())?.artists?.items || [];
      const best = artists.find(a => a.name.toLowerCase() === artistName.toLowerCase()) || artists[0];
      artistId = best?.id || null;
    }
  } catch {}

  const out = [];
  // 1) Top-tracks אם יש מזהה אמן
  if (artistId) {
    try{
      const tUrl = `https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=${market||"IL"}`;
      const tr = await fetch(tUrl, { headers:{ Authorization:`Bearer ${token}` }});
      if (tr.ok){
        const items = (await tr.json())?.tracks || [];
        out.push(...items);
      }
    } catch {}
  }

  // 2) חיפוש track לפי artist:"name"
  try {
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(`artist:"${artistName}"`)}&type=track&limit=50${market?`&market=${market}`:""}`;
    const r = await fetch(url,{ headers:{ Authorization:`Bearer ${token}` }});
    if (r.ok){
      const items = (await r.json())?.tracks?.items || [];
      out.push(...items);
    }
  } catch {}

  // ניקוי: רק אם האמן הראשי הוא האמן המבוקש (או מופיע ברשימת האמנים)
  const filtered = out.filter(t =>
    (t.artists?.[0]?.name || "").toLowerCase().trim() === artistName.toLowerCase().trim()
    || (t.artists || []).some(a => a.name.toLowerCase().trim() === artistName.toLowerCase().trim())
  );

  // מיון לפי פופולריות והסרת כפולים לפי title+artist
  const seen = new Set();
  const uniq = [];
  for (const t of filtered.sort((a,b)=>(b.popularity||0)-(a.popularity||0))){
    const title = t.name;
    const primary = t.artists?.[0]?.name || artistName;
    const key = canonicalKey(title, primary);
    if (!seen.has(key)){
      seen.add(key);
      uniq.push({ title, artist: primary });
    }
  }
  return uniq;
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

    // נרמול סידס לספוטיפיי
    const normalizedSeeds = [];
    for (const raw of seedsRaw){
      const norm = await normalizeSeed(token, raw);
      if (norm && norm.title && norm.artist){
        normalizedSeeds.push(norm);
      }
    }

    // סדר אמנים לפי הופעתם בסידס (יוניק)
    const artistOrder = [];
    const artistSeen = new Set();
    normalizedSeeds.forEach(({artist})=>{
      const key = artist.toLowerCase().trim();
      if (!artistSeen.has(key)){ artistSeen.add(key); artistOrder.push(artist); }
    });

    // חייבים לפחות 5 אמנים שונים
    if (artistOrder.length < 5) {
      return res.status(400).json({ error: "יש צורך בלפחות 5 זמרים/אמנים שונים ברשימת השירים. ודא שהפורמט הוא Title - Artist ושמדובר בשירים קיימים." });
    }

    // יעד לפי מספר הסידס (עם מינימום קשיח 20)
    const targetSoft = seedsRaw.length <= 7 ? randInt(25,40) : randInt(35,50);
    const targetTotal = Math.max(targetSoft, TARGET_MIN);

    // בנה דליים לכל אמן: תחילה הסידס שלו, אח״כ טראקים פופולריים
    const buckets = {};
    const pickedKeys = new Set();

    for (const artist of artistOrder){
      buckets[artist] = [];

      // 1) סידס של האמן
      normalizedSeeds
        .filter(s => s.artist.toLowerCase().trim() === artist.toLowerCase().trim())
        .forEach(s => {
          const key = canonicalKey(s.title, s.artist);
          if (!pickedKeys.has(key)){
            pickedKeys.add(key);
            buckets[artist].push(`${s.title} - ${s.artist}`);
          }
        });

      // 2) טראקים נוספים לאמן
      const extra = await fetchArtistTracks(token, artist);
      for (const t of extra){
        const key = canonicalKey(t.title, t.artist);
        if (!pickedKeys.has(key)){
          pickedKeys.add(key);
          buckets[artist].push(`${t.title} - ${t.artist}`);
        }
      }
    }

    // כמות זרעים לכל אמן
    const seedCountByArtist = {};
    for (const artist of artistOrder){
      seedCountByArtist[artist] = normalizedSeeds.filter(s => s.artist.toLowerCase().trim() === artist.toLowerCase().trim()).length;
    }

    // הקצאת מכסות מאוזנת:
    // מתחילים מכמות הזרעים, ואז round-robin מוסיפים אחד-אחד עד targetTotal
    const quotas = {};
    const usedCounts = {};
    let totalQuota = 0;

    artistOrder.forEach(a => {
      quotas[a] = Math.min(buckets[a].length, seedCountByArtist[a]); // לפחות הזרעים
      usedCounts[a] = 0;
      totalQuota += quotas[a];
    });

    // כמה נותר להקצות
    let remaining = Math.max(targetTotal - totalQuota, 0);

    // Round-robin הגדלת מכסות, מנסה להגיע לאיזון (בערך targetTotal/numArtists)
    const perArtistIdeal = Math.ceil(targetTotal / artistOrder.length);

    while (remaining > 0) {
      let progressed = false;
      for (const a of artistOrder){
        if (remaining <= 0) break;
        const cap = Math.min(perArtistIdeal, buckets[a].length);
        if (quotas[a] < cap){
          quotas[a] += 1;
          remaining -= 1;
          progressed = true;
        }
      }
      // אם עדיין נשאר—חלק עוד סבב לכל מי שיש לו מלאי
      if (!progressed) {
        for (const a of artistOrder){
          if (remaining <= 0) break;
          if (quotas[a] < buckets[a].length){
            quotas[a] += 1;
            remaining -= 1;
            progressed = true;
          }
        }
      }
      if (!progressed) break; // אין מה להוסיף
    }

    // בנייה מאוזנת עם מניעת רצפים ארוכים
    const cursors = {};
    artistOrder.forEach(a => { cursors[a] = 0; });

    const final = [];
    let lastArtist = null;
    let consec = 0;

    function canPick(artist){
      if (usedCounts[artist] >= quotas[artist]) return false;
      if (cursors[artist] >= buckets[artist].length) return false;
      // מניעת רצף
      if (lastArtist && lastArtist.toLowerCase() === artist.toLowerCase() && consec >= MAX_CONSEC) return false;
      return true;
    }

    // לולאת interleave
    while (final.length < targetTotal) {
      let took = false;

      for (const a of artistOrder){
        if (final.length >= targetTotal) break;

        // אם אסור לפי MAX_CONSEC, ננסה לחפש אמן אחר; אם כולם חסומים, נרפה את המגבלה לסבב הזה
        if (!canPick(a)) continue;

        // בחר טRack הבא מהדלי של האמן
        const track = buckets[a][cursors[a]];
        cursors[a] += 1;
        usedCounts[a] += 1;

        final.push(track);

        if (!lastArtist || lastArtist.toLowerCase() !== a.toLowerCase()) {
          lastArtist = a;
          consec = 1;
        } else {
          consec += 1;
        }

        took = true;
      }

      if (!took) {
        // ייתכן שכולם נחסמו בגלל MAX_CONSEC—נרפה בסבב אחד כדי לא להתקע
        let relaxedTook = false;
        for (const a of artistOrder){
          if (final.length >= targetTotal) break;
          if (usedCounts[a] >= quotas[a]) continue;
          if (cursors[a] >= buckets[a].length) continue;

          const track = buckets[a][cursors[a]];
          cursors[a] += 1;
          usedCounts[a] += 1;
          final.push(track);

          if (!lastArtist || lastArtist.toLowerCase() !== a.toLowerCase()) {
            lastArtist = a;
            consec = 1;
          } else {
            consec += 1;
          }
          relaxedTook = true;
          break;
        }
        if (!relaxedTook) break; // אין יותר מה להוסיף
      }
    }

    // ערבוב קל של ה"non-seeds" בתוך האמן עצמו כבר בוצע לפי פופולריות;
    // כאן הרשימה כבר מאוזנת בין אמנים ובד"כ בלי רצפים ארוכים.

    // ✅ הבטחת ה-seeds ברשימה הסופית (לפי normalizedSeeds)
// ✅ הבטחת ה-seeds ברשימה הסופית (לפי normalizedSeeds) + שמירת סדר המקור
const seedLines = normalizedSeeds.map(s => `${s.title} - ${s.artist}`);
const finalKeys = new Set(final.map(keyFromLine));
const missingSeeds = [];

for (const seed of seedLines) {
  if (!finalKeys.has(keyFromLine(seed))) {
    missingSeeds.push(seed);
    finalKeys.add(keyFromLine(seed));
  }
}

// מקדימים את כל החסרים לפי סדר המקור
if (missingSeeds.length) {
  final.unshift(...missingSeeds);
}

// אם עברנו את היעד, נגזור חזרה לאורך היעד (ה-seeds כבר בפנים)
if (final.length > targetTotal) {
  final.length = targetTotal;
}

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
