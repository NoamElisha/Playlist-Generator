import React from 'react';

export default function ClaudePlaylist({ playlistText }) {
 
  const lines = (playlistText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  return (
    <section className="suggested-recipe-container" aria-live="polite">
      <h2>Suggested Playlist</h2>
      <ol style={{ textAlign: 'left', display: 'inline-block', paddingLeft: 24 }}>
        {lines.map((line, idx) => (
          <li key={idx} style={{ marginBottom: '1rem', lineHeight: '1.4' }}>
            {line}
          </li>
        ))}
      </ol>
    </section>
  );
}