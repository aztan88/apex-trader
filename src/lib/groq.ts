// Groq inference — OpenAI-compatible API, ~0.5s responses
// Free tier: generous limits, no credit card required
// Models: llama-3.3-70b-versatile (best quality), llama-3.1-8b-instant (fastest)

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile'; // fast + high quality

function getKey() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY not set in environment variables');
  return key;
}

export async function groq(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 600
): Promise<string> {
  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getKey()}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Groq API ${res.status}: ${(err as any)?.error?.message ?? res.statusText}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response from Groq');
  return text;
}

// Simpler call without system prompt
export async function groqSimple(prompt: string, maxTokens = 100): Promise<string> {
  return groq('You are a helpful assistant. Be concise.', prompt, maxTokens);
}
