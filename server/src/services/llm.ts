import OpenAI from 'openai';
import { config } from '../config.js';

const client = new OpenAI({
  baseURL: 'https://llm.api.cloud.yandex.net/v1',
  apiKey: config.YANDEX_API_KEY,
});

const model = `gpt://${config.YANDEX_FOLDER_ID}/${config.MODEL_ID}/latest`;

export type LLMMessage = { role: 'user' | 'assistant'; content: string };

export async function streamChat(messages: LLMMessage[]) {
  return client.chat.completions.create({ model, messages, stream: true });
}
