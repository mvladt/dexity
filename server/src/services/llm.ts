import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { config } from '../config.js';

export type { ChatCompletionMessageParam as LLMMessage };

const client = new OpenAI({
  baseURL: 'https://llm.api.cloud.yandex.net/v1',
  apiKey: config.YC_API_KEY,
});

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
