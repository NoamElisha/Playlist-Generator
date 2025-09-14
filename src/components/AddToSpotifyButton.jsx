// src/components/AddToSpotifyButton.jsx
import { parsePlaylistTextToTracks } from '../utils/parsePlaylistText';

export default function AddToSpotifyButton({ playlistText }) {
  const tracks = parsePlaylistTextToTracks(playlistText);

  async function handleAdd() {
    try {
      console.log('▶ Creating playlist on Spotify, tracks:', tracks);
      const res = await fetch('/api/spotify/create-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'AI Playlist', tracks })
      });
      if (res.status === 401) {
        // redirect to login
        console.log('Not authenticated, redirecting to Spotify login...');
        window.location.href = '/api/spotify/login';
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create playlist');
      console.log('◀ Spotify create-playlist response:', data);
      alert(`Playlist created! Open: ${data.playlistUrl}`);
    } catch (err) {
      console.error('AddToSpotifyButton error:', err);
      alert('Error: ' + (err.message || err));
    }
  }

  return <button onClick={handleAdd}>Add Playlist to Spotify</button>;
}
