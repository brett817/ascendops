import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  getCurrentCap,
  readHeadersSource,
  readDashboardSource,
  readEstimateSource,
  type CapReadout,
} from '../../src/bus/cap-readout.js';

const ORG = 'testorg';
const AGENT = 'testagent';

let tmpRoot: string;
let savedEnv: Record<string, string | undefined>;

function writeHeadersFile(headers: Record<string, string | number>, captured_at?: string): string {
  const dir = join(tmpRoot, 'orgs', ORG, 'state', AGENT);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'last-ratelimit-headers.json');
  writeFileSync(path, JSON.stringify({ headers, captured_at }), 'utf-8');
  return path;
}

function writeAccountsFile(accessToken: string): void {
  const dir = join(tmpRoot, 'state', 'oauth');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'accounts.json'),
    JSON.stringify({
      active: 'primary',
      accounts: { primary: { access_token: accessToken } },
    }),
    'utf-8',
  );
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'cap-readout-test-'));
  savedEnv = {
    CTX_ROOT: process.env.CTX_ROOT,
    CTX_ORG: process.env.CTX_ORG,
    CTX_AGENT_NAME: process.env.CTX_AGENT_NAME,
    CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
  };
  // Wipe so DI opts take over deterministically.
  delete process.env.CTX_ROOT;
  delete process.env.CTX_ORG;
  delete process.env.CTX_AGENT_NAME;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
});

afterEach(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('readHeadersSource', () => {
  it('returns null when capture file is missing', async () => {
    const result = await readHeadersSource({ ctxRoot: tmpRoot, org: ORG, agent: AGENT });
    expect(result).toBeNull();
  });

  it('returns null when capture file is invalid JSON', async () => {
    const dir = join(tmpRoot, 'orgs', ORG, 'state', AGENT);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'last-ratelimit-headers.json'), 'not-json', 'utf-8');

    const result = await readHeadersSource({ ctxRoot: tmpRoot, org: ORG, agent: AGENT });
    expect(result).toBeNull();
  });

  it('computes 5h pct from tokens-limit / tokens-remaining', async () => {
    writeHeadersFile({
      'anthropic-ratelimit-tokens-limit': 1000,
      'anthropic-ratelimit-tokens-remaining': 250,
    });

    const result = await readHeadersSource({ ctxRoot: tmpRoot, org: ORG, agent: AGENT });
    expect(result).not.toBeNull();
    expect(result!.source).toBe('headers');
    // 1000 - 250 = 750 used → 75%
    expect(result!.five_hour_pct).toBe(75);
    expect(result!.agent).toBe(AGENT);
  });

  it('falls back to input-tokens then requests when tokens bucket absent', async () => {
    writeHeadersFile({
      'anthropic-ratelimit-input-tokens-limit': '200',
      'anthropic-ratelimit-input-tokens-remaining': '50',
    });

    const result = await readHeadersSource({ ctxRoot: tmpRoot, org: ORG, agent: AGENT });
    expect(result!.five_hour_pct).toBe(75);
  });

  it('reads weekly bucket separately', async () => {
    writeHeadersFile({
      'anthropic-ratelimit-tokens-limit': 100,
      'anthropic-ratelimit-tokens-remaining': 90,
      'anthropic-ratelimit-weekly-tokens-limit': 1000,
      'anthropic-ratelimit-weekly-tokens-remaining': 800,
    });

    const result = await readHeadersSource({ ctxRoot: tmpRoot, org: ORG, agent: AGENT });
    expect(result!.five_hour_pct).toBe(10);
    expect(result!.weekly_pct).toBe(20);
  });

  it('returns null when no recognised bucket headers present', async () => {
    writeHeadersFile({ 'x-unrelated': 'foo' });
    const result = await readHeadersSource({ ctxRoot: tmpRoot, org: ORG, agent: AGENT });
    expect(result).toBeNull();
  });

  it('clamps pct into 0-100 even on absurd inputs', async () => {
    writeHeadersFile({
      'anthropic-ratelimit-tokens-limit': 10,
      'anthropic-ratelimit-tokens-remaining': -999,
    });
    const result = await readHeadersSource({ ctxRoot: tmpRoot, org: ORG, agent: AGENT });
    expect(result!.five_hour_pct).toBe(100);
  });

  it('normalises header keys regardless of case', async () => {
    writeHeadersFile({
      'Anthropic-Ratelimit-Tokens-Limit': 1000,
      'Anthropic-Ratelimit-Tokens-Remaining': 100,
    });
    const result = await readHeadersSource({ ctxRoot: tmpRoot, org: ORG, agent: AGENT });
    expect(result!.five_hour_pct).toBe(90);
  });
});

describe('readDashboardSource', () => {
  it('returns null when no OAuth token is available', async () => {
    const result = await readDashboardSource({
      ctxRoot: tmpRoot, org: ORG, agent: AGENT,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect(result).toBeNull();
  });

  it('returns null on 401 (broken auth)', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok_test';
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });

    const result = await readDashboardSource({
      ctxRoot: tmpRoot, org: ORG, agent: AGENT,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('returns null when fetch throws (network error)', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok_test';
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await readDashboardSource({
      ctxRoot: tmpRoot, org: ORG, agent: AGENT,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBeNull();
  });

  it('parses 0-1 fractional utilization', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok_test';
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ five_hour_utilization: 0.11, seven_day_utilization: 0.03 }),
    });

    const result = await readDashboardSource({
      ctxRoot: tmpRoot, org: ORG, agent: AGENT,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).not.toBeNull();
    expect(result!.source).toBe('dashboard');
    expect(result!.five_hour_pct).toBeCloseTo(11, 5);
    expect(result!.weekly_pct).toBeCloseTo(3, 5);
  });

  it('accepts 0-100 percent-formatted utilization', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok_test';
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ five_hour_utilization: 45, weekly_utilization: 12 }),
    });

    const result = await readDashboardSource({
      ctxRoot: tmpRoot, org: ORG, agent: AGENT,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result!.five_hour_pct).toBe(45);
    expect(result!.weekly_pct).toBe(12);
  });

  it('reads token from accounts.json when env not set', async () => {
    writeAccountsFile('tok_from_file');
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ five_hour_utilization: 0.5 }),
    });

    const result = await readDashboardSource({
      ctxRoot: tmpRoot, org: ORG, agent: AGENT,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result!.source).toBe('dashboard');
    const callArgs = fetchImpl.mock.calls[0];
    expect((callArgs[1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer tok_from_file',
    });
  });

  it('returns null when response JSON has no recognised fields', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok_test';
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ unrelated: true }),
    });

    const result = await readDashboardSource({
      ctxRoot: tmpRoot, org: ORG, agent: AGENT,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBeNull();
  });
});

describe('readEstimateSource', () => {
  it('returns a valid CapReadout with source=estimate', () => {
    const result = readEstimateSource({ agent: AGENT, uptimeSecs: () => 0 });
    expect(result.source).toBe('estimate');
    expect(result.five_hour_pct).toBe(0);
    expect(result.weekly_pct).toBe(0);
    expect(result.agent).toBe(AGENT);
    expect(result.meta?.confidence).toBe('low');
  });

  it('scales 5h pct linearly with uptime', () => {
    // Half the 5h window → ~50%
    const halfFiveHours = 2.5 * 60 * 60;
    const result = readEstimateSource({ agent: AGENT, uptimeSecs: () => halfFiveHours });
    expect(result.five_hour_pct).toBeCloseTo(50, 1);
  });

  it('clamps to 100 when uptime exceeds the 5h window', () => {
    const result = readEstimateSource({ agent: AGENT, uptimeSecs: () => 99999999 });
    expect(result.five_hour_pct).toBe(100);
    expect(result.weekly_pct).toBe(100);
  });

  it('defaults agent to "fleet" when none provided', () => {
    const result = readEstimateSource({ uptimeSecs: () => 0 });
    expect(result.agent).toBe('fleet');
  });
});

describe('getCurrentCap (fallback ordering)', () => {
  it('returns headers source when capture file present', async () => {
    writeHeadersFile({
      'anthropic-ratelimit-tokens-limit': 100,
      'anthropic-ratelimit-tokens-remaining': 89,
    });
    const fetchImpl = vi.fn(); // must not be called

    const result = await getCurrentCap({
      ctxRoot: tmpRoot, org: ORG, agent: AGENT,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.source).toBe('headers');
    expect(result.five_hour_pct).toBe(11);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls through to dashboard when no headers file', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok_test';
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ five_hour_utilization: 0.22, weekly_utilization: 0.07 }),
    });

    const result = await getCurrentCap({
      ctxRoot: tmpRoot, org: ORG, agent: AGENT,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.source).toBe('dashboard');
    expect(result.five_hour_pct).toBeCloseTo(22, 5);
    expect(result.weekly_pct).toBeCloseTo(7, 5);
  });

  it('falls through to estimate when headers missing AND dashboard 401s', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok_test';
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });

    const result = await getCurrentCap({
      ctxRoot: tmpRoot, org: ORG, agent: AGENT,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      uptimeSecs: () => 0,
    });

    expect(result.source).toBe('estimate');
    expect(result.five_hour_pct).toBe(0);
    expect(result.agent).toBe(AGENT);
  });

  it('falls through to estimate when no token and no headers', async () => {
    const result = await getCurrentCap({
      ctxRoot: tmpRoot, org: ORG, agent: AGENT,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      uptimeSecs: () => 60,
    });

    expect(result.source).toBe('estimate');
  });

  it('never returns null/undefined — always a valid CapReadout', async () => {
    const result = await getCurrentCap({
      ctxRoot: tmpRoot, org: ORG, agent: AGENT,
      uptimeSecs: () => 0,
    });
    expect(result).toBeDefined();
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const sources: CapReadout['source'][] = ['headers', 'dashboard', 'estimate'];
    expect(sources).toContain(result.source);
  });

  it('still returns a readout when headers source throws unexpectedly', async () => {
    // Write a file path that points at a directory to force a read error path.
    const dir = join(tmpRoot, 'orgs', ORG, 'state', AGENT);
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, 'last-ratelimit-headers.json'), { recursive: true });

    const result = await getCurrentCap({
      ctxRoot: tmpRoot, org: ORG, agent: AGENT,
      uptimeSecs: () => 0,
    });
    // Should fall through to estimate without throwing.
    expect(['dashboard', 'estimate']).toContain(result.source);
  });
});
