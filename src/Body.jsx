// src/Body.jsx
import React from "react";
import SongsList from "./components/SongsList";
import ClaudePlaylist from "./components/ClaudePlaylist";
import AddToSpotifyButton from "./components/AddToSpotifyButton";
import { getPlaylistFromChefClaude } from "./ai";

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isValidPlaylistName(name) {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > 100) return false;
  if (/[\x00-\x1F\x7F]/.test(trimmed)) return false;
  return true;
}

export default function Body() {
  const [songs, setSongs] = React.useState([]);
  const [playlistText, setPlaylistText] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [playlistName, setPlaylistName] = React.useState('AI Playlist');
  const [lastParams, setLastParams] = React.useState(null);

  async function getPlaylist() {
    try {
      setError('');
      setLoading(true);
      // choose random artist count (5-8) and total tracks (20-40)
      const desiredArtistsCount = randInt(5, 8);
      const desiredTotal = randInt(20, 40);
      setLastParams({ desiredArtistsCount, desiredTotal });

      console.log('▶ Sending songs to server (playlist-claude):', songs, desiredArtistsCount, desiredTotal);
      const data = await getPlaylistFromChefClaude(songs, desiredArtistsCount, desiredTotal);
      console.log('◀ Received from server:', data);
      setPlaylistText(data.playlistText || '');
      if (data.warning) setError(data.warning);
    } catch (err) {
      console.error('getPlaylist error:', err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  function addSong(e){
    e.preventDefault();
    const f = new FormData(e.target);
    const song = f.get('song')?.trim();
    if (!song) return;
    setSongs(prev => [...prev, song]);
    e.target.reset();
  }

  return (
    <main style={{maxWidth:980, margin:'0 auto', padding:24}}>
      <div style={{display:'flex', justifyContent:'center', marginBottom:16}}>
        <input
          value={playlistName}
          onChange={e => setPlaylistName(e.target.value)}
          placeholder="Playlist name (will be used when adding to Spotify)"
          style={{padding:10, borderRadius:8, border:'1px solid #e5e7eb', width: '60%'}}
        />
      </div>

      <form onSubmit={addSong} className="add-ingredient-form card">
        <input name="song" placeholder='Example: "Bad Guy - Billie Eilish"' aria-label="Add song (Title - Artist)" />
        <button type="submit">Add</button>
      </form>

      {songs.length === 0 && (
        <p style={{color:'#6B7280', marginTop:12}}>
          Add at least 5 songs (format: <code>Title - Artist</code>) then press Generate Playlist.
        </p>
      )}

      <SongsList songs={songs} />

      <div style={{display:'flex', justifyContent:'center', gap:12, marginTop:12}}>
        <button
          onClick={getPlaylist}
          disabled={songs.length < 5}
          style={{padding:'10px 16px', borderRadius:8, background:'#111827', color:'#fff', border:'none', cursor: songs.length < 5 ? 'not-allowed' : 'pointer'}}
        >
          Generate Playlist
        </button>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{color:'red'}}>{error}</p>}
      {playlistText && <ClaudePlaylist playlistText={playlistText} />}
      {playlistText && (
        <AddToSpotifyButton
          playlistText={playlistText}
          playlistName={isValidPlaylistName(playlistName) ? playlistName.trim() : 'AI Playlist'}
        />
      )}
    </main>
  );
}
