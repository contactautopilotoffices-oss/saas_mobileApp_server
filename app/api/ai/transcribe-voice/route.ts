import { NextResponse } from 'next/server';

const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as Blob;
    const model = formData.get('model') || 'whisper-large-v3';
    const language = formData.get('language') || 'en';

    if (!file) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 500 });
    }

    const groqFormData = new FormData();
    groqFormData.append('file', file);
    groqFormData.append('model', model as string);
    groqFormData.append('language', language as string);

    const res = await fetch(GROQ_TRANSCRIBE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: groqFormData,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[Groq] Transcription failed:', res.status, errText);
      return NextResponse.json({ error: 'Groq API error', details: errText }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[API] /api/ai/transcribe-voice error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
