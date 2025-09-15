// src/components/AddToSpotifyButton.jsx
import { parsePlaylistTextToTracks } from '../utils/parsePlaylistText';

export default function AddToSpotifyButton({ playlistText, playlistName }) {
  const tracks = parsePlaylistTextToTracks(playlistText);

  async function handleAdd() {
    try {
      console.log('▶ Creating playlist on Spotify, tracks:', tracks, 'name:', playlistName);
      const res = await fetch('/api/spotify/create-playlist', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: playlistName || 'AI Playlist', tracks })
      });

      console.log('create-playlist: HTTP status', res.status);

      if (res.status === 401) {
        console.log('Not authenticated, redirecting to Spotify login...');
        window.location.href = '/api/spotify/login';
        return;
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create playlist');
      console.log('◀ Spotify create-playlist response:', data);
      if (data.playlistUrl) {
        // open playlist in new tab
        window.open(data.playlistUrl, '_blank');
      } else {
        alert('Playlist created (no URL returned). Check your Spotify library.');
      }
    } catch (err) {
      console.error('AddToSpotifyButton error:', err);
      alert('Error: ' + (err.message || err));
    }
  }

  return <button onClick={handleAdd} style={{padding:'10px 16px', borderRadius:8, background:'#1DB954', color:'#fff', border:'none'}}>Add Playlist to Spotify</button>;
}
