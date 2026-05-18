import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getDefaultTimeZoneForLocation, STREAM_CANDIDATE_SEEDS, type StreamCandidate, type StreamReviewStatus } from '../data/streamCandidates';

type SeedCandidate = Omit<StreamCandidate, 'createdAt' | 'updatedAt' | 'timeZone'>;

const CATALOG_FILE_PATH = path.join(process.cwd(), 'src/data/streamCandidates.ts');
const START_MARKER = 'export const STREAM_CANDIDATE_SEEDS: StreamCandidate[] = ([';
const END_MARKER = '] satisfies SeedCandidate[])';
const STATUS_OPTIONS = new Set<StreamReviewStatus>(['unreviewed', 'accepted', 'rejected']);
const SAVED_AT = '2026-04-24T00:00:00.000Z';

export async function loadStreamCandidates() {
  return {
    candidates: STREAM_CANDIDATE_SEEDS,
    configured: true,
    writable: true,
  };
}

function requireString(value: unknown, field: keyof SeedCandidate): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid stream candidate ${field}`);
  }

  return value;
}

function normalizeCandidate(value: unknown): SeedCandidate {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid stream candidate');
  }

  const candidate = value as Record<string, unknown>;
  const status = requireString(candidate.status, 'status');
  if (!STATUS_OPTIONS.has(status as StreamReviewStatus)) {
    throw new Error(`Invalid stream candidate status: ${status}`);
  }

  const id = requireString(candidate.id, 'id').trim();
  if (!id) {
    throw new Error('Stream candidate id is required');
  }

  return {
    id,
    name: requireString(candidate.name, 'name'),
    category: requireString(candidate.category, 'category'),
    location: requireString(candidate.location, 'location'),
    streamUrl: requireString(candidate.streamUrl, 'streamUrl'),
    pageUrl: requireString(candidate.pageUrl, 'pageUrl'),
    format: requireString(candidate.format, 'format'),
    source: requireString(candidate.source, 'source'),
    status: status as StreamReviewStatus,
    notes: requireString(candidate.notes, 'notes'),
  };
}

function toTsString(value: string): string {
  return `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}'`;
}

function serializeCandidate(candidate: SeedCandidate): string {
  return [
    '  {',
    `    id: ${toTsString(candidate.id)},`,
    `    name: ${toTsString(candidate.name)},`,
    `    category: ${toTsString(candidate.category)},`,
    `    location: ${toTsString(candidate.location)},`,
    `    streamUrl: ${toTsString(candidate.streamUrl)},`,
    `    pageUrl: ${toTsString(candidate.pageUrl)},`,
    `    format: ${toTsString(candidate.format)},`,
    `    source: ${toTsString(candidate.source)},`,
    `    status: ${toTsString(candidate.status)},`,
    `    notes: ${toTsString(candidate.notes)},`,
    '  },',
  ].join('\n');
}

function replaceSeedArray(source: string, candidates: SeedCandidate[]): string {
  const start = source.indexOf(START_MARKER);
  const end = source.indexOf(END_MARKER, start + START_MARKER.length);

  if (start === -1 || end === -1) {
    throw new Error('Could not locate STREAM_CANDIDATE_SEEDS array in src/data/streamCandidates.ts');
  }

  const before = source.slice(0, start + START_MARKER.length);
  const after = source.slice(end);
  const entries = candidates.map(serializeCandidate).join('\n');

  return `${before}\n${entries}\n${after}`;
}

export async function saveStreamCandidates(candidates: unknown): Promise<StreamCandidate[]> {
  if (!Array.isArray(candidates)) {
    throw new Error('Expected candidates array');
  }

  const normalized = candidates.map(normalizeCandidate);
  const seenIds = new Set<string>();
  for (const candidate of normalized) {
    if (seenIds.has(candidate.id)) {
      throw new Error(`Duplicate stream candidate id: ${candidate.id}`);
    }
    seenIds.add(candidate.id);
  }

  const source = await readFile(CATALOG_FILE_PATH, 'utf8');
  const nextSource = replaceSeedArray(source, normalized);
  if (nextSource !== source) {
    await writeFile(CATALOG_FILE_PATH, nextSource);
  }

  return normalized.map(candidate => ({
    ...candidate,
    timeZone: getDefaultTimeZoneForLocation(candidate.location),
    createdAt: SAVED_AT,
    updatedAt: SAVED_AT,
  }));
}
