// src/components/SongsList.jsx
import React from 'react';

export default function SongsList({ songs }) {
  return (
    <section className="card">
      <h2>Your songs:</h2>
      <ul className="ingredients-list" style={{textAlign:'left', maxWidth:700, margin:'8px auto'}}>
        {songs.map((s, idx) => <li key={idx} style={{marginBottom:6}}>{s}</li>)}
      </ul>
      <p style={{color:'#6b7280', fontSize:'0.9rem'}}>You added {songs.length} songs.</p>
    </section>
  );
}
