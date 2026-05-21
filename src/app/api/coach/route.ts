import { NextRequest, NextResponse } from 'next/server';
import { groq } from '@/lib/groq';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { question, portfolioContext } = body;
    if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 });
    const userPrompt = portfolioContext ? `${portfolioContext}\n\nQuestion: ${question}` : question;
    const reply = await groq(
      'Expert investment coach. Specific, actionable, educational. Clear paragraphs. No disclaimers.',
      userPrompt,
      700
    );
    return NextResponse.json({ reply });
  } catch (e: any) {
    console.error('[coach]', e?.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
