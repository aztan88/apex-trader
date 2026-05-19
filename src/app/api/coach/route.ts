import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { question, portfolioContext } = body;
    if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 });

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 700,
      system: 'You are an expert investment coach with decades of experience managing global equity portfolios. Give specific, actionable, educational advice. Use clear paragraphs. Be direct and honest. No boilerplate disclaimers. No generic statements.',
      messages: [{
        role: 'user',
        content: portfolioContext
          ? `${portfolioContext}\n\nQuestion: ${question}`
          : question,
      }],
    });

    const reply = (msg.content[0] as any).text;
    return NextResponse.json({ reply, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
