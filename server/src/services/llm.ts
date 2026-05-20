import OpenAI from 'openai';
import { config } from '../config.js';

const client = new OpenAI({
  baseURL: 'https://llm.api.cloud.yandex.net/v1',
  apiKey: config.YANDEX_API_KEY,
});

export type LLMMessage = { role: 'user' | 'assistant' | 'system'; content: string };

export async function streamChat(
  messages: LLMMessage[],
  signal?: AbortSignal,
  model?: string,
) {
  const modelId = model ?? config.MODEL_ID;
  const fullModel = `gpt://${config.YANDEX_FOLDER_ID}/${modelId}/latest`;
  return client.chat.completions.create(
    { model: fullModel, messages, stream: true },
    { signal },
  );
}
