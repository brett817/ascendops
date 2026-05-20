import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CapReadout } from '../../src/bus/cap-readout';

// Mock the sister-agent source module before importing query-cap so the
// queryCap wrapper picks up the mocked getCurrentCap.
const mockGetCurrentCap = vi.fn();
vi.mock('../../src/bus/cap-readout.js', () => ({
  getCurrentCap: mockGetCurrentCap,
}));
vi.mock('../../src/bus/cap-readout', () => ({
  getCurrentCap: mockGetCurrentCap,
}));

const { queryCap } = await import('../../src/bus/query-cap');

function makeReadout(overrides: Partial<CapReadout> = {}): CapReadout {
  return {
    source: 'headers',
    five_hour_pct: 11,
    weekly_pct: 3,
    timestamp: '2026-05-19T14:00:00Z',
    agent: 'aussie',
    ...overrides,
  };
}

describe('queryCap (bus/query-cap)', () => {
  beforeEach(() => {
    mockGetCurrentCap.mockReset();
  });

  it('emits a valid CapReadout shape when source=headers', async () => {
    mockGetCurrentCap.mockResolvedValueOnce(makeReadout());

    const out = await queryCap();
    // Round-trip through JSON to assert the CLI serialization contract.
    const parsed = JSON.parse(JSON.stringify(out)) as CapReadout;

    expect(parsed.source).toBe('headers');
    expect(parsed.five_hour_pct).toBe(11);
    expect(parsed.weekly_pct).toBe(3);
    expect(parsed.agent).toBe('aussie');
    expect(typeof parsed.timestamp).toBe('string');
  });

  it('forwards --agent flag to getCurrentCap', async () => {
    mockGetCurrentCap.mockResolvedValueOnce(makeReadout({ agent: 'collie' }));

    const out = await queryCap({ agent: 'collie' });

    expect(mockGetCurrentCap).toHaveBeenCalledTimes(1);
    expect(mockGetCurrentCap).toHaveBeenCalledWith({ agent: 'collie' });
    expect(out.agent).toBe('collie');
  });

  it('passes undefined agent when no flag given (defers to source-layer default)', async () => {
    mockGetCurrentCap.mockResolvedValueOnce(makeReadout());

    await queryCap();

    expect(mockGetCurrentCap).toHaveBeenCalledWith({ agent: undefined });
  });

  it('succeeds with source=dashboard (degraded path) — exit code stays 0', async () => {
    mockGetCurrentCap.mockResolvedValueOnce(makeReadout({ source: 'dashboard' }));

    const out = await queryCap();
    expect(out.source).toBe('dashboard');
    // queryCap itself does not throw — the CLI action handler is what owns
    // exit codes; this asserts the wrapper never converts a degraded source
    // into an error.
  });

  it('succeeds with source=estimate (fully degraded fallback) — exit code stays 0', async () => {
    mockGetCurrentCap.mockResolvedValueOnce(
      makeReadout({ source: 'estimate', meta: { reason: 'headers + dashboard unavailable' } }),
    );

    const out = await queryCap();
    expect(out.source).toBe('estimate');
    expect(out.meta).toBeDefined();
  });

  it('propagates unexpected errors so the CLI can exit 1', async () => {
    mockGetCurrentCap.mockRejectedValueOnce(new Error('unexpected'));

    await expect(queryCap()).rejects.toThrow('unexpected');
  });
});
