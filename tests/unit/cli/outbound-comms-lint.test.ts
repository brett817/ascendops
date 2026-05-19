import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

const sendMessageSpy = vi.fn().mockReturnValue('msg-test-1');
const telegramSendSpy = vi.fn().mockResolvedValue({ result: { message_id: 1 } });

vi.mock('../../../src/bus/message.js', () => ({
  sendMessage: (...args: unknown[]) => sendMessageSpy(...args),
  checkInbox: vi.fn(() => []),
  ackInbox: vi.fn(),
}));

vi.mock('../../../src/bus/event.js', () => ({
  logEvent: vi.fn(),
}));

vi.mock('../../../src/telegram/api.js', () => ({
  TelegramAPI: class {
    constructor(_token: string) {}
    sendMessage(...args: unknown[]) {
      return telegramSendSpy(...args);
    }
    sendPhoto = vi.fn().mockResolvedValue({ result: { message_id: 1 } });
    sendDocument = vi.fn().mockResolvedValue({ result: { message_id: 1 } });
  },
}));

import { busCommand } from '../../../src/cli/bus';

let tempCtx: string;
let originalCtxRoot: string | undefined;
let originalAgentName: string | undefined;
let originalBotToken: string | undefined;
let originalInstanceId: string | undefined;
let originalHome: string | undefined;

beforeEach(() => {
  tempCtx = mkdtempSync(join(tmpdir(), 'comms-lint-ctx-'));
  mkdirSync(join(tempCtx, 'logs', 'test-agent'), { recursive: true });
  mkdirSync(join(tempCtx, 'inbox', 'target-agent'), { recursive: true });

  originalCtxRoot = process.env.CTX_ROOT;
  originalAgentName = process.env.CTX_AGENT_NAME;
  originalBotToken = process.env.BOT_TOKEN;
  originalInstanceId = process.env.CTX_INSTANCE_ID;
  originalHome = process.env.HOME;

  process.env.CTX_ROOT = tempCtx;
  process.env.CTX_AGENT_NAME = 'test-agent';
  process.env.BOT_TOKEN = 'fake-token';
  process.env.CTX_INSTANCE_ID = 'default';
  process.env.HOME = tempCtx;

  sendMessageSpy.mockClear();
  telegramSendSpy.mockClear();
});

afterEach(() => {
  if (originalCtxRoot === undefined) delete process.env.CTX_ROOT;
  else process.env.CTX_ROOT = originalCtxRoot;

  if (originalAgentName === undefined) delete process.env.CTX_AGENT_NAME;
  else process.env.CTX_AGENT_NAME = originalAgentName;

  if (originalBotToken === undefined) delete process.env.BOT_TOKEN;
  else process.env.BOT_TOKEN = originalBotToken;

  if (originalInstanceId === undefined) delete process.env.CTX_INSTANCE_ID;
  else process.env.CTX_INSTANCE_ID = originalInstanceId;

  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;

  rmSync(tempCtx, { recursive: true, force: true });
});

describe('outbound comms lint', () => {
  it('blocks send-telegram when banned jargon is present', async () => {
    await expect(
      busCommand.parseAsync(['send-telegram', '12345', 'Standing by for next task'], { from: 'user' })
    ).rejects.toThrow();
    expect(telegramSendSpy).not.toHaveBeenCalled();
  });

  it('allows send-telegram with --skip-lint escape hatch', async () => {
    await busCommand.parseAsync(
      ['send-telegram', '12345', 'Standing by for next task', '--skip-lint'],
      { from: 'user' },
    );
    expect(telegramSendSpy).toHaveBeenCalledTimes(1);
  });

  it('blocks send-message on passive waiting posture with no active context', async () => {
    await expect(
      busCommand.parseAsync(['send-message', 'target-agent', 'normal', 'waiting for feedback'], { from: 'user' })
    ).rejects.toThrow();
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it('allows send-message when waiting includes specific next-signal context', async () => {
    await busCommand.parseAsync(
      ['send-message', 'target-agent', 'normal', 'waiting for review; next heartbeat at 00:06 UTC'],
      { from: 'user' },
    );
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });

  it('blocks send-mobile-reply on banned posture phrase', async () => {
    await expect(
      busCommand.parseAsync(['send-mobile-reply', 'test-agent', 'parked here until tomorrow'], { from: 'user' })
    ).rejects.toThrow();

    const outPath = join(homedir(), '.cortextos', 'default', 'logs', 'test-agent', 'outbound-messages.jsonl');
    expect(existsSync(outPath)).toBe(false);
  });

  it('allows send-mobile-reply with --skip-lint and writes outbound log', async () => {
    await busCommand.parseAsync(
      ['send-mobile-reply', 'test-agent', 'parked here until tomorrow', '--skip-lint'],
      { from: 'user' },
    );

    const outPath = join(homedir(), '.cortextos', 'default', 'logs', 'test-agent', 'outbound-messages.jsonl');
    expect(existsSync(outPath)).toBe(true);
    const body = readFileSync(outPath, 'utf-8');
    expect(body).toContain('parked here until tomorrow');
  });
});
