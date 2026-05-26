// Groq inference — OpenAI-compatible API, ~0.5s responses
// Free tier limits (on_demand): 100k tokens/day per model
// Strategy: use llama-3.1-8b-instant for high-volume calls (signals, search)
//           use llama-3.3-70b-versatile only for deep analysis and discovery

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

// Two models — fast/cheap for volume, quality for depth
const MODEL_FAST  = 'llama-3.1-8b-instant';    // 100k TPD free, ~4x fewer tokens used
const MODEL_DEEP  = 'llama-3.3-70b-versatile'; // 100k TPD free, best quality

function getKey() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY not set in environment variables');
  return key;
}

async function callGroq(model: string, systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getKey()}`,
    },
    body: JSON.stringify({
      model,
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

// Fast model — for signals, search, coach (high volume, short outputs)
export async function groq(systemPrompt: string, userPrompt: string, maxTokens = 300): Promise<string> {
  return callGroq(MODEL_FAST, systemPrompt, userPrompt, maxTokens);
}

// Deep model — for discovery and full analysis only (low volume, high quality)
export async function groqDeep(systemPrompt: string, userPrompt: string, maxTokens = 600): Promise<string> {
  return callGroq(MODEL_DEEP, systemPrompt, userPrompt, maxTokens);
}

// Simple call without explicit system prompt
export async function groqSimple(prompt: string, maxTokens = 80): Promise<string> {
  return callGroq(MODEL_FAST, 'Be concise and direct.', prompt, maxTokens);
}
