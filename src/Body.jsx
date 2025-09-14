// src/Body.jsx
import React from "react";
import SongsList from "./components/SongsList";
import ClaudePlaylist from "./components/ClaudePlaylist";
import AddToSpotifyButton from "./components/AddToSpotifyButton"; // <- חשוב לייבא!
import { getPlaylistFromChefClaude } from "./ai";

export default function Body() {
  const [songs, setSongs] = React.useState([]); // start empty
  const [playlistText, setPlaylistText] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  async function getPlaylist() {
    try {
      console.log('▶ Sending songs to server (playlist-claude):', songs);
      setError('');
      setLoading(true);
      const text = await getPlaylistFromChefClaude(songs);
      console.log('◀ Received playlistText from server:', text);
      setPlaylistText(text);
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
    <main>
      <form onSubmit={addSong} className="add-ingredient-form">
        <input name="song" placeholder='Example: "Bad Guy - Billie Eilish"' aria-label="Add song (Title - Artist)" />
        <button type="submit">Add</button>
      </form>

      {/* Helpful hint (not part of the songs list) */}
      {songs.length === 0 && (
        <p style={{color:'#6B7280', marginTop:12}}>
          Add at least 5 songs (format: <code>Title - Artist</code>) then press Generate Playlist.
        </p>
      )}

      <SongsList songs={songs} getPlaylist={getPlaylist} />

      {loading && <p>Loading…</p>}
      {error && <p style={{color:'red'}}>{error}</p>}
      {playlistText && <ClaudePlaylist playlistText={playlistText} />}
      {/* make sure AddToSpotifyButton is imported (top of file) */}
      {playlistText && <AddToSpotifyButton playlistText={playlistText} />}
    </main>
  );
}
