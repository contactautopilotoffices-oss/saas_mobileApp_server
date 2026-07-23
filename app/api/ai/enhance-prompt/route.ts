import { NextResponse } from 'next/server';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

export async function POST(request: Request) {
  try {
    const { text } = await request.json();

    if (!text || text.trim().length < 3) {
      return NextResponse.json({ error: 'Text too short' }, { status: 400 });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 500 });
    }

    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You are a concise grammar and writing assistant. Take the user\'s ticket description and fix only grammar, spelling, and sentence structure. Keep the original meaning, facts, and length. Do NOT add new details, do NOT expand the description, do NOT rewrite it as a full ticket, and do NOT add bullet points or facility context. Return ONLY the corrected text with no preamble or quotes.',
          },
          { role: 'user', content: text },
        ],
        temperature: 0.1,
        max_tokens: 800,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[Groq] Prompt enhancement failed:', res.status, errText);
      return NextResponse.json({ error: 'Groq API error' }, { status: res.status });
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      return NextResponse.json({ error: 'No content from Groq' }, { status: 500 });
    }

    // Clean up any surrounding quotes the model might add
    const cleanedContent = content.replace(/^["']|["']$/g, '').trim();

    return NextResponse.json({ text: cleanedContent });
  } catch (error: any) {
    console.error('[API] /api/ai/enhance-prompt error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
