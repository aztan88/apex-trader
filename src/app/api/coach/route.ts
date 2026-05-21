import { NextRequest, NextResponse } from 'next/server';
import { gemini } from '@/lib/gemini';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { question, portfolioContext } = body;
    if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 });

    const userPrompt = portfolioContext
      ? `${portfolioContext}\n\nQuestion: ${question}`
      : question;

    const reply = await gemini(
      'You are an expert investment coach with decades of experience. Give specific, actionable, educational advice. Use clear paragraphs. Be direct and honest. No boilerplate disclaimers.',
      userPrompt,
      700
    );
    return NextResponse.json({ reply });
  } catch (e: any) {
    console.error('[coach] Error:', e?.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
