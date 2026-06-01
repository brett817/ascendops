import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the inbox-write sink so sendMessage is a spy and never touches disk.
vi.mock('../../../src/bus/message.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/bus/message.js')>();
  return { ...actual, sendMessage: vi.fn() };
});

// Mock SlackAPI so getUserName is controllable per-test and no network happens.
const getUserNameMock = vi.fn();
vi.mock('../../../src/slack/api.js', () => ({
  SlackAPI: vi.fn().mockImplementation(function () {
    return { getUserName: getUserNameMock };
  }),
}));

import { SlackSocketListener } from '../../../src/daemon/slack-socket-listener.js';
import { sendMessage } from '../../../src/bus/message.js';
import type { SlackMessageEvent } from '../../../src/slack/slack-socket.js';
import type { BusPaths } from '../../../src/types/index.js';

const sendMessageMock = vi.mocked(sendMessage);

// Minimal BusPaths stub — handleMessage never reads disk because sendMessage is mocked.
const paths = { ctxRoot: '/tmp/fake' } as unknown as BusPaths;

function makeEvent(overrides: Partial<SlackMessageEvent> = {}): SlackMessageEvent {
  return {
    type: 'message',
    channel: 'C123',
    user: 'U999',
    text: 'hello team',
    ts: '1700000000.000100',
    ...overrides,
  };
}

function makeListener(log: (msg: string) => void = () => {}): SlackSocketListener {
  return new SlackSocketListener({
    appToken: 'xapp-test',
    botToken: 'xoxb-test',
    channel: 'C123',
    agentName: 'collie',
    paths,
    log,
  });
}

describe('SlackSocketListener.handleMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserNameMock.mockReset();
  });

  it('happy path: resolves display name and writes one inbox message', async () => {
    getUserNameMock.mockResolvedValue('Carlos Calel');
    const listener = makeListener();

    await listener.handleMessage(makeEvent());

    const expectedText =
      '=== SLACK from Carlos Calel (channel:C123 ts:1700000000.000100) ===\n' +
      'hello team\n' +
      'Reply using: cortextos bus send-slack C123 "<reply>"';

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith(
      paths,
      'fast-checker',
      'collie',
      'normal',
      expectedText,
    );
    // Spot-check the load-bearing substrings.
    const actualText = sendMessageMock.mock.calls[0][4];
    expect(actualText).toContain('from Carlos Calel');
    expect(actualText).toContain('ts:1700000000.000100');
    expect(actualText).toContain('channel:C123');
  });

  it('exact formatted string shape: header, body line, reply line', async () => {
    getUserNameMock.mockResolvedValue('Carlos Calel');
    const listener = makeListener();

    await listener.handleMessage(makeEvent());

    const text = sendMessageMock.mock.calls[0][4] as string;
    const lines = text.split('\n');
    expect(lines[0]).toBe('=== SLACK from Carlos Calel (channel:C123 ts:1700000000.000100) ===');
    expect(lines[1]).toBe('hello team');
    expect(lines[2]).toBe('Reply using: cortextos bus send-slack C123 "<reply>"');
  });

  // A captionless file/photo share has no text field — the body must be empty,
  // NOT the literal string "undefined".
  it('captionless share (no text) renders an empty body, never "undefined"', async () => {
    getUserNameMock.mockResolvedValue('Carlos Calel');
    const listener = makeListener();

    await listener.handleMessage(makeEvent({ text: undefined as unknown as string }));

    const text = sendMessageMock.mock.calls[0][4] as string;
    expect(text).not.toContain('undefined');
    const lines = text.split('\n');
    expect(lines[0]).toBe('=== SLACK from Carlos Calel (channel:C123 ts:1700000000.000100) ===');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('Reply using: cortextos bus send-slack C123 "<reply>"');
  });

  it('getUserName rejecting falls back to the raw user id', async () => {
    getUserNameMock.mockRejectedValue(new Error('slack api down'));
    const listener = makeListener();

    await listener.handleMessage(makeEvent({ user: 'U777' }));

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const text = sendMessageMock.mock.calls[0][4] as string;
    expect(text).toContain('from U777');
    expect(text.startsWith('=== SLACK from U777 (channel:C123 ts:1700000000.000100) ===')).toBe(true);
  });

  it('empty user falls back to "unknown"', async () => {
    getUserNameMock.mockResolvedValue('');
    const listener = makeListener();

    await listener.handleMessage(makeEvent({ user: '' }));

    const text = sendMessageMock.mock.calls[0][4] as string;
    expect(text).toContain('from unknown');
  });

  it('sendMessage throwing does not throw out of handleMessage and is logged', async () => {
    getUserNameMock.mockResolvedValue('Carlos Calel');
    sendMessageMock.mockImplementation(() => {
      throw new Error('disk full');
    });
    const logSpy = vi.fn();
    const listener = makeListener(logSpy);

    await expect(listener.handleMessage(makeEvent())).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('Slack socket inbox write failed');
  });
});
