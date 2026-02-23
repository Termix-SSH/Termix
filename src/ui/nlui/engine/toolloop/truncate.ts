import type { Message } from '../types';

function estimateTokens(msg: Message): number {
  let n = msg.content.length;
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      n += tc.function.name.length + tc.function.arguments.length;
    }
  }
  return Math.ceil(n / 4);
}

interface Block {
  start: number;
  end: number;   // exclusive
  tokens: number;
}

/**
 * Truncate messages to fit within a token budget.
 *
 * Rules:
 *  1. System message (index 0 if role=system) is always kept.
 *  2. Recent messages are preserved (scan from tail).
 *  3. Assistant+tool_calls and subsequent tool messages form an atomic block — never split.
 *  4. maxTokens <= 0 disables truncation.
 */
export function truncateMessages(messages: Message[], maxTokens: number): Message[] {
  if (maxTokens <= 0 || messages.length === 0) return messages;

  let budget = maxTokens;
  let startIdx = 0;

  if (messages[0].role === 'system') {
    budget -= estimateTokens(messages[0]);
    startIdx = 1;
    if (budget <= 0) return [messages[0]];
  }

  const rest = messages.slice(startIdx);
  const blocks: Block[] = [];
  let i = 0;

  while (i < rest.length) {
    const msg = rest[i];
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      const b: Block = { start: i, end: i + 1, tokens: estimateTokens(msg) };
      let j = i + 1;
      while (j < rest.length && rest[j].role === 'tool') {
        b.tokens += estimateTokens(rest[j]);
        j++;
      }
      b.end = j;
      blocks.push(b);
      i = j;
    } else {
      blocks.push({ start: i, end: i + 1, tokens: estimateTokens(msg) });
      i++;
    }
  }

  // Scan from tail
  let used = 0;
  let cutBlock = 0;
  for (let k = blocks.length - 1; k >= 0; k--) {
    if (used + blocks[k].tokens > budget) {
      cutBlock = k + 1;
      break;
    }
    used += blocks[k].tokens;
  }

  if (cutBlock >= blocks.length) {
    return startIdx > 0 ? [messages[0]] : [];
  }

  const cutIdx = startIdx + blocks[cutBlock].start;
  const out: Message[] = [];
  if (startIdx > 0) out.push(messages[0]);
  out.push(...messages.slice(cutIdx));
  return out;
}
