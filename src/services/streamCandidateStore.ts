import { GetObjectCommand, type GetObjectCommandOutput, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { spawn } from 'node:child_process';
import {
  STREAM_CANDIDATE_SEEDS,
  getDefaultTimeZoneForLocation,
  isRetiredStreamCandidateId,
  type StreamCandidate,
  type StreamReviewStatus,
} from '../data/streamCandidates';

const DEFAULT_OBJECT_KEY = 'stream-candidates.json';
const DEFAULT_BUCKET = 'resonator-stream-review';
const YAMANAKAKO_OLD_STREAM_URL = 'http://cyberforest.nenv.k.u-tokyo.ac.jp/Fuji_CyberForest.mp3';
const PALESTINE_AL_HARA_ID = 'locus-palestine-al-hara';
const PALESTINE_AL_HARA_OLD_ID = 'radioalhara-palestine';
const PALESTINE_AL_HARA_OLD_STREAM_URL = 'https://stream.radiojar.com/78cxy6wkxtzuv';
let lastKnownGoodCandidates: StreamCandidate[] | null = null;

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  objectKey: string;
}

interface R2Target {
  bucket: string;
  objectKey: string;
}

function getR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    objectKey: process.env.R2_STREAM_CANDIDATES_KEY || DEFAULT_OBJECT_KEY,
  };
}

function getR2Target(): R2Target {
  return {
    bucket: process.env.R2_BUCKET || DEFAULT_BUCKET,
    objectKey: process.env.R2_STREAM_CANDIDATES_KEY || DEFAULT_OBJECT_KEY,
  };
}

function getClient(config: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function isReviewStatus(value: unknown): value is StreamReviewStatus {
  return value === 'unreviewed' || value === 'accepted' || value === 'rejected';
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeCandidate(value: unknown, index: number): StreamCandidate {
  const item = value && typeof value === 'object' ? value as Partial<StreamCandidate> : {};
  const now = new Date().toISOString();
  const id = asString(item.id).trim() || `candidate-${Date.now()}-${index}`;
  const location = asString(item.location);
  const seed = STREAM_CANDIDATE_SEEDS.find(candidate => candidate.id === id);

  return {
    id,
    name: asString(item.name),
    category: asString(item.category) || 'unreviewed',
    location,
    timeZone: asString(item.timeZone) || seed?.timeZone || getDefaultTimeZoneForLocation(location),
    streamUrl: asString(item.streamUrl),
    pageUrl: asString(item.pageUrl),
    format: asString(item.format),
    source: asString(item.source),
    status: isReviewStatus(item.status) ? item.status : 'unreviewed',
    notes: asString(item.notes),
    createdAt: asString(item.createdAt) || now,
    updatedAt: asString(item.updatedAt) || now,
  };
}

function repairCandidate(candidate: StreamCandidate): StreamCandidate {
  if (
    candidate.id === PALESTINE_AL_HARA_OLD_ID ||
    candidate.streamUrl === PALESTINE_AL_HARA_OLD_STREAM_URL ||
    candidate.source === 'Radio Alhara / Radiojar' ||
    candidate.format === 'MP3 Radiojar'
  ) {
    const seed = STREAM_CANDIDATE_SEEDS.find(seedCandidate => seedCandidate.id === PALESTINE_AL_HARA_ID);
    if (!seed) return candidate;

    return {
      ...candidate,
      id: seed.id,
      name: seed.name,
      category: seed.category,
      location: seed.location,
      streamUrl: seed.streamUrl,
      pageUrl: seed.pageUrl,
      format: seed.format,
      source: seed.source,
      status: seed.status,
      notes: seed.notes,
      timeZone: seed.timeZone,
      updatedAt: new Date().toISOString(),
    };
  }

  if (candidate.id !== 'locus-yamanakako-cyberforest' || candidate.streamUrl !== YAMANAKAKO_OLD_STREAM_URL) {
    return candidate;
  }

  const seed = STREAM_CANDIDATE_SEEDS.find(seedCandidate => seedCandidate.id === candidate.id);
  if (!seed) return candidate;

  return {
    ...candidate,
    streamUrl: seed.streamUrl,
    pageUrl: seed.pageUrl,
    format: seed.format,
    source: seed.source,
    notes: seed.notes,
    timeZone: candidate.timeZone || seed.timeZone,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeCandidates(value: unknown): StreamCandidate[] {
  const candidates = Array.isArray(value) ? value : [];
  return candidates
    .map(normalizeCandidate)
    .map(repairCandidate)
    .filter(candidate => !isRetiredStreamCandidateId(candidate.id));
}

function mergeWithSeeds(saved: StreamCandidate[]): StreamCandidate[] {
  const seen = new Set(saved.map(candidate => candidate.id));
  const missingSeeds = STREAM_CANDIDATE_SEEDS.filter(candidate => !seen.has(candidate.id));
  const enriched = saved.map(candidate => {
    if (candidate.timeZone) return candidate;
    const seed = STREAM_CANDIDATE_SEEDS.find(seedCandidate => seedCandidate.id === candidate.id);
    return {
      ...candidate,
      timeZone: seed?.timeZone || getDefaultTimeZoneForLocation(candidate.location),
    };
  });
  return [...enriched, ...missingSeeds];
}

async function readBodyAsText(body: GetObjectCommandOutput['Body']): Promise<string> {
  if (!body) return '';

  if ('transformToString' in body && typeof body.transformToString === 'function') {
    return body.transformToString();
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function runWrangler(args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const child = spawn(command, ['wrangler', ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.on('error', reject);
    child.on('close', code => {
      const output = Buffer.concat(stdout).toString('utf8');
      const errorOutput = Buffer.concat(stderr).toString('utf8');
      if (code === 0) {
        resolve(output);
        return;
      }
      reject(new Error(errorOutput || output || `wrangler exited with code ${code}`));
    });

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

function isMissingObjectError(error: unknown): boolean {
  if (error instanceof NoSuchKey) return true;
  if (!(error instanceof Error)) return false;
  return error.name === 'NoSuchKey' || /not found|NoSuchKey|404/i.test(error.message);
}

async function loadWithWrangler(): Promise<StreamCandidate[]> {
  const target = getR2Target();
  const text = await runWrangler(['r2', 'object', 'get', `${target.bucket}/${target.objectKey}`, '--pipe']);
  return normalizeCandidates(JSON.parse(text));
}

async function saveWithWrangler(candidates: StreamCandidate[]): Promise<void> {
  const target = getR2Target();
  await runWrangler(
    ['r2', 'object', 'put', `${target.bucket}/${target.objectKey}`, '--pipe', '--content-type', 'application/json'],
    JSON.stringify(candidates, null, 2),
  );
}

function normalizeForSave(candidates: StreamCandidate[]): StreamCandidate[] {
  return normalizeCandidates(candidates).map(candidate => ({
    ...candidate,
    updatedAt: candidate.updatedAt || new Date().toISOString(),
  }));
}

function rememberCandidates(candidates: StreamCandidate[]): StreamCandidate[] {
  lastKnownGoodCandidates = candidates;
  return candidates;
}

export async function loadStreamCandidates(): Promise<{ candidates: StreamCandidate[]; configured: boolean }> {
  const config = getR2Config();
  if (!config) {
    try {
      const saved = await loadWithWrangler();
      const candidates = mergeWithSeeds(saved);

      if (JSON.stringify(candidates) !== JSON.stringify(saved)) {
        await saveWithWrangler(candidates);
      }

      return { candidates: rememberCandidates(candidates), configured: true };
    } catch (error) {
      if (isMissingObjectError(error)) {
        await saveWithWrangler(STREAM_CANDIDATE_SEEDS);
        return { candidates: rememberCandidates(STREAM_CANDIDATE_SEEDS), configured: true };
      }

      return { candidates: lastKnownGoodCandidates ?? STREAM_CANDIDATE_SEEDS, configured: false };
    }
  }

  try {
    const response = await getClient(config).send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: config.objectKey,
    }));
    const text = await readBodyAsText(response.Body);
    const saved = normalizeCandidates(JSON.parse(text));
    const candidates = mergeWithSeeds(saved);

    if (JSON.stringify(candidates) !== JSON.stringify(saved)) {
      await saveStreamCandidates(candidates);
    }

    return { candidates: rememberCandidates(candidates), configured: true };
  } catch (error) {
    if (isMissingObjectError(error)) {
      await saveStreamCandidates(STREAM_CANDIDATE_SEEDS);
      return { candidates: rememberCandidates(STREAM_CANDIDATE_SEEDS), configured: true };
    }

    if (lastKnownGoodCandidates) {
      return { candidates: lastKnownGoodCandidates, configured: false };
    }

    throw error;
  }
}

export async function saveStreamCandidates(candidates: StreamCandidate[]): Promise<{ configured: boolean }> {
  const config = getR2Config();
  const normalized = normalizeForSave(candidates);

  if (!config) {
    try {
      await saveWithWrangler(normalized);
      return { configured: true };
    } catch {
      return { configured: false };
    }
  }

  await getClient(config).send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: config.objectKey,
    Body: JSON.stringify(normalized, null, 2),
    ContentType: 'application/json; charset=utf-8',
  }));

  return { configured: true };
}
