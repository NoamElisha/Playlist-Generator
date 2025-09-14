// src/components/ApiKeyForm.jsx
import { useState } from "react";

export default function ApiKeyForm() {
  const [key, setKey] = useState(localStorage.getItem('ANTHROPIC_API_KEY') || '');

  function saveKey(e) {
    e?.preventDefault();
    localStorage.setItem('ANTHROPIC_API_KEY', key);
    alert('Anthropic API key saved locally (dev only). Remember to revoke after use!');
  }

  function clearKey() {
    localStorage.removeItem('ANTHROPIC_API_KEY');
    setKey('');
    alert('Key cleared from localStorage.');
  }

  return (
    <form onSubmit={saveKey} style={{ marginBottom: 12, textAlign: 'center' }}>
      <input
        placeholder="Paste Anthropic key for local dev (sk-...)"
        value={key}
        onChange={e => setKey(e.target.value)}
        style={{ width: 400, maxWidth: '80%', padding: 6 }}
      />
      <button type="submit">Save key</button>
      <button type="button" onClick={clearKey} style={{ marginLeft: 8 }}>Clear</button>
    </form>
  );
}
