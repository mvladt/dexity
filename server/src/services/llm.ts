import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { config } from '../config.js';

export type { ChatCompletionMessageParam as LLMMessage };

const client = new OpenAI({
  baseURL: 'https://llm.api.cloud.yandex.net/v1',
  apiKey: config.YC_API_KEY,
});

// Лёгкая быстрая модель для одноразового резюме прочитанной страницы (web_fetch).
const SUMMARY_MODEL_ID = 'aliceai-llm-flash';

/**
 * Делает компактное резюме веб-страницы для превью в плашке Web Fetch.
 * Отдельный дешёвый вызов — не блокирует основную модель (она получает полный текст).
 */
export async function summarizePage(content: string, signal?: AbortSignal): Promise<string> {
  const fullModel = `gpt://${config.YC_FOLDER_ID}/${SUMMARY_MODEL_ID}/latest`;
  const res = await client.chat.completions.create(
    {
      model: fullModel,
      messages: [
        {
          role: 'system',
          content:
            'Сделай компактное резюме веб-страницы для превью: 2–3 предложения, максимум 5. ' +
            'Только суть, без вступлений и воды. Резюме всегда на русском языке, независимо от языка страницы.',
        },
        { role: 'user', content },
      ],
      stream: false,
      temperature: 0.3,
      max_tokens: 400,
    },
    { signal },
  );
  return res.choices[0]?.message?.content?.trim() ?? '';
}

export async function streamChat(
  messages: ChatCompletionMessageParam[],
  signal?: AbortSignal,
  model?: string,
  tools?: ChatCompletionTool[],
  toolChoice?: 'auto' | 'none' | 'required',
) {
  const modelId = model ?? config.MODEL_ID;
  const fullModel = `gpt://${config.YC_FOLDER_ID}/${modelId}/latest`;
  return client.chat.completions.create(
    {
      model: fullModel,
      messages,
      stream: true,
      ...(tools ? { tools, tool_choice: toolChoice ?? 'auto' } : {}),
    },
    { signal },
  );
}
