import { GoogleGenerativeAI } from '@google/generative-ai';

// gemini-2.5-flash-lite — free tier, fast, current stable model as of May 2026
const MODEL = 'gemini-2.5-flash-lite';

function getClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set in environment variables');
  return new GoogleGenerativeAI(key);
}

export async function gemini(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 600
): Promise<string> {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: MODEL,
    systemInstruction: systemPrompt,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.3, // lower = more consistent structured output
    },
  });
  const result = await model.generateContent(userPrompt);
  const text = result.response.text();
  if (!text) throw new Error('Empty response from Gemini');
  return text;
}

export async function geminiSimple(prompt: string, maxTokens = 600): Promise<string> {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: MODEL,
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
  });
  const result = await model.generateContent(prompt);
  return result.response.text() ?? '';
}
