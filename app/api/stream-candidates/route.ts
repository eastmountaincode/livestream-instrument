import { NextResponse } from 'next/server';
import { loadStreamCandidates, saveStreamCandidates } from '../../../src/services/streamCandidateStore';
import type { StreamCandidate } from '../../../src/data/streamCandidates';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const { candidates, configured } = await loadStreamCandidates();
    return NextResponse.json({ candidates, configured });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load stream candidates' },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const payload = await request.json() as { candidates?: StreamCandidate[] };
    const { configured } = await saveStreamCandidates(payload.candidates ?? []);

    if (!configured) {
      return NextResponse.json(
        { error: 'R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.' },
        { status: 503 },
      );
    }

    const { candidates } = await loadStreamCandidates();
    return NextResponse.json({ candidates, configured });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save stream candidates' },
      { status: 500 },
    );
  }
}
