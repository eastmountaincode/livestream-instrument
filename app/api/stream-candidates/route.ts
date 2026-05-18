import { NextRequest, NextResponse } from 'next/server';
import { loadStreamCandidates, saveStreamCandidates } from '../../../src/services/streamCandidateStore';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const { candidates, configured, writable } = await loadStreamCandidates();
    return NextResponse.json({ candidates, configured, writable });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load stream candidates' },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const payload = await request.json() as { candidates?: unknown };
    const candidates = await saveStreamCandidates(payload.candidates);
    return NextResponse.json({ candidates, configured: true, writable: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save stream candidates' },
      { status: 400 },
    );
  }
}
