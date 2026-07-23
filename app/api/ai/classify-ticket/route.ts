import { NextResponse } from 'next/server';
import { classifyWithGroq } from '@/lib/llm/groq';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { ticketText, scores, dbPriority } = body;

    if (!ticketText) {
      return NextResponse.json({ error: 'Missing ticketText' }, { status: 400 });
    }

    // Convert mobile input to backend LLMInput format
    const candidate_buckets = Object.keys(scores || {}).filter(k => scores[k] > 0);
    if (candidate_buckets.length === 0) {
      candidate_buckets.push('technical', 'plumbing', 'vendor', 'soft_services');
    }

    const input = {
      ticket_text: ticketText,
      candidate_buckets,
      rule_scores: scores || {},
      db_priority: dbPriority,
    };

    const response = await classifyWithGroq(input);

    if (!response.success || !response.result) {
      return NextResponse.json({ error: response.error || 'LLM classification failed' }, { status: 500 });
    }

    // Map result back to what mobile expects
    return NextResponse.json({
      priority: response.result.priority?.toLowerCase() || 'medium',
      primary_category: response.result.primary_category?.toLowerCase() || null,
      risk_flag: response.result.risk_flag || null,
      reasoning: response.result.reasoning || null,
      secondary_category_code: response.result.secondary_category || null,
    });
  } catch (error: any) {
    console.error('[API] /api/ai/classify-ticket error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
