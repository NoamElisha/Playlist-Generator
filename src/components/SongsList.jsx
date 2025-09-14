export default function SongsList({ songs, getPlaylist }) {
  return (
    <section>
      <h2>Your songs:</h2>
      <ul className="ingredients-list">
        {songs.map((s, idx) => <li key={idx}>{s}</li>)}
      </ul>

      {songs.length >= 5 && (
        <div className="get-recipe-container">
          <div>
            <h3>Ready for a playlist?</h3>
            <p>Generate a playlist from your songs.</p>
          </div>
          <button onClick={getPlaylist}>Generate Playlist</button>
        </div>
      )}
    </section>
  );
}
