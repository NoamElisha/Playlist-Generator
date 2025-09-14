import React from 'react';
import ReactMarkdown from 'react-markdown';

export default function ClaudePlaylist({ playlistText }) {
  return (
    <section className="suggested-recipe-container" aria-live="polite">
      <h2>Suggested Playlist</h2>
      <ReactMarkdown>{playlistText}</ReactMarkdown>
    </section>
  );
}
