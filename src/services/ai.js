import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { store } from '../db/index.js';

const client = new OpenAI({
  baseURL: config.AI_BASE_URL,
  apiKey: config.AI_API_KEY,
});

/**
 * Issue a chat-completion that returns parsed JSON.
 * IMPORTANT: pass `system` as a stable string per task type so
 * provider-side prefix caching (when available) maximizes hits.
 *
 * Returns: { data, usage }
 */
export async function chatJSON({ system, user, temperature = 0.2, maxTokens }) {
  const res = await client.chat.completions.create({
    model: config.AI_MODEL,
    temperature,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
  });

  store.bumpStat('ai_calls');
  const usage = res.usage ?? {};
  if (usage.prompt_tokens) store.bumpStat('prompt_tokens', usage.prompt_tokens);
  if (usage.completion_tokens) store.bumpStat('completion_tokens', usage.completion_tokens);

  const raw = res.choices[0]?.message?.content ?? '{}';
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    logger.warn({ err, raw }, 'AI returned non-JSON; attempting recovery');
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI response was not valid JSON');
    data = JSON.parse(match[0]);
  }
  return { data, usage };
}
