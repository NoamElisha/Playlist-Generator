// /src/ai.js
const SYSTEM_PROMPT = `
You are an assistant that receives a list of ingredients that a user has and suggests a recipe they could make with some or all of those ingredients.
You don't need to use every ingredient they mention in your recipe. The recipe can include additional ingredients they didn't mention, but try not to include too many extra ingredients.
Format your response in markdown to make it easier to render to a web page.
`;


const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || localStorage.getItem('ANTHROPIC_API_KEY');


export async function getPlaylistFromChefClaude(songsArr) {
  console.log('client: getPlaylistFromChefClaude -> sending', songsArr);
  const res = await fetch('/api/playlist-claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songs: songsArr })
  });

  if (!res.ok) {
  
    const txt = await res.text();
    try {
      const j = JSON.parse(txt);
      throw new Error(j.error || txt);
    } catch {
      throw new Error(txt);
    }
  }

  const data = await res.json(); 
  return data;
}


export async function getRecipeFromChefClaude(ingredientsArr) {
  const res = await fetch('/api/recipe-claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ingredients: ingredientsArr })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Server error ${res.status}: ${txt}`);
  }
  const data = await res.json();
  return data.recipe || "No recipe returned.";
}

export async function getRecipeFromAnthropic(body) {
  if (!ANTHROPIC_KEY) throw new Error('No Anthropic API key found.');
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error('Anthropic response text (error):', txt);
    throw new Error(`Anthropic API error ${res.status}: ${txt}`);
  }
  const data = await res.json();
  console.log('Anthropic response data:', data);
  if (data?.completion) return data.completion;
  if (data?.messages?.length) return data.messages.map(m => m.text || m.content).join("\n");
  return JSON.stringify(data);
}
