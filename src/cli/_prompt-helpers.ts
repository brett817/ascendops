// Shared readline prompt helpers for interactive CLI wizards.
// Originally lived inside src/cli/setup.ts and src/cli/configure.ts copies — lifted
// here so both wizards (and any future ones) share the same UX without drift.

import { createInterface, type Interface } from 'readline';
import { Writable } from 'stream';

export function rl(): Interface {
  return createInterface({ input: process.stdin, output: process.stdout });
}

export function ask(iface: Interface, question: string): Promise<string> {
  return new Promise(resolve =>
    iface.question(question, answer => resolve(answer.trim())),
  );
}

export function askRequired(
  iface: Interface,
  question: string,
  errorMsg: string,
): Promise<string> {
  return new Promise(async resolve => {
    while (true) {
      const answer = await ask(iface, question);
      if (answer) {
        resolve(answer);
        return;
      }
      console.log(`  ${errorMsg}`);
    }
  });
}

export function askDefault(
  iface: Interface,
  question: string,
  defaultVal: string,
): Promise<string> {
  return new Promise(resolve =>
    iface.question(`${question} [${defaultVal}]: `, answer => {
      const trimmed = answer.trim();
      resolve(trimmed || defaultVal);
    }),
  );
}

export function askYN(
  iface: Interface,
  question: string,
  defaultYes = false,
): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  return new Promise(resolve =>
    iface.question(`${question} [${hint}]: `, answer => {
      const a = answer.trim().toLowerCase();
      if (!a) return resolve(defaultYes);
      resolve(a === 'y' || a === 'yes');
    }),
  );
}

// Numbered single-choice picker. Operator types a number, gets the value.
export async function askChoice(
  iface: Interface,
  question: string,
  options: string[],
): Promise<string> {
  while (true) {
    console.log(`  ${question}`);
    options.forEach((opt, i) => console.log(`    ${i + 1}) ${opt}`));
    const raw = await ask(iface, '  Pick a number: ');
    const idx = parseInt(raw, 10);
    if (Number.isInteger(idx) && idx >= 1 && idx <= options.length) {
      return options[idx - 1];
    }
    console.log(`  Enter a number between 1 and ${options.length}.`);
  }
}

// Multi-select via comma-separated numbers. Empty input = pick nothing.
export async function askMultiChoice(
  iface: Interface,
  question: string,
  options: string[],
): Promise<string[]> {
  while (true) {
    console.log(`  ${question}`);
    options.forEach((opt, i) => console.log(`    ${i + 1}) ${opt}`));
    const raw = await ask(iface, '  Pick numbers (comma-separated, or blank for none): ');
    if (!raw) return [];
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    const picks = parts.map(p => parseInt(p, 10));
    if (picks.every(n => Number.isInteger(n) && n >= 1 && n <= options.length)) {
      return picks.map(n => options[n - 1]);
    }
    console.log(`  Each number must be between 1 and ${options.length}.`);
  }
}

// Masked-input prompt for secrets. No echo to terminal scrollback.
// Falls back to plain ask() if the input isn't a TTY (e.g., piped) — in that
// path a 'masked' read isn't meaningful anyway and we shouldn't deadlock.
export function askMasked(
  iface: Interface,
  question: string,
): Promise<string> {
  if (!process.stdin.isTTY) {
    return ask(iface, question);
  }

  return new Promise(resolve => {
    process.stdout.write(question);

    let captured = '';
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw ?? false;

    const onData = (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      for (const ch of s) {
        const code = ch.charCodeAt(0);
        if (ch === '\n' || ch === '\r') {
          stdin.removeListener('data', onData);
          stdin.setRawMode(wasRaw);
          stdin.pause();
          process.stdout.write('\n');
          resolve(captured.trim());
          return;
        } else if (code === 3) {
          // Ctrl+C — restore and exit
          stdin.setRawMode(wasRaw);
          process.stdout.write('\n');
          process.exit(130);
        } else if (code === 127 || code === 8) {
          // Backspace
          if (captured.length > 0) captured = captured.slice(0, -1);
        } else if (code >= 32) {
          captured += ch;
        }
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

// Multi-line free-text capture. Operator types lines; double-Enter ends.
// Returns the joined string (lines separated by \n) trimmed at edges.
export async function askMultiline(
  iface: Interface,
  preamble: string,
): Promise<string> {
  console.log(`  ${preamble}`);
  console.log('  (Press Enter twice when done. Type "skip" alone on a line to skip.)');
  const lines: string[] = [];
  let lastWasBlank = false;
  while (true) {
    const line = await ask(iface, '    ');
    if (line === 'skip') return '';
    if (line === '') {
      if (lastWasBlank || lines.length === 0) break;
      lastWasBlank = true;
      lines.push('');
    } else {
      lastWasBlank = false;
      lines.push(line);
    }
  }
  return lines.join('\n').trim();
}

// _unused helper for type-checking the imported Writable shim above; keep it
// here so the import isn't pruned by TS organizing.
export type _PromptWritable = Writable;
