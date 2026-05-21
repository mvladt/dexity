export interface ModelInfo {
  id: string;
  label: string;
  maxContext: number;
}

export const MODELS: ModelInfo[] = [
  { id: 'yandexgpt-lite', label: 'YandexGPT Lite', maxContext: 8000 },
  { id: 'yandexgpt', label: 'YandexGPT', maxContext: 8000 },
  { id: 'yandexgpt-32k', label: 'YandexGPT 32k', maxContext: 32000 },
  { id: 'qwen3-235b-a22b-fp8', label: 'Qwen3 235B', maxContext: 32000 },
  { id: 'qwen3.6-35b-a3b', label: 'Qwen3.6 35B', maxContext: 262144 },
  { id: 'deepseek-v32', label: 'DeepSeek V3.2', maxContext: 131072 },
  { id: 'gpt-oss-120b', label: 'GPT-OSS 120B', maxContext: 131072 },
  { id: 'gpt-oss-20b', label: 'GPT-OSS 20B', maxContext: 131072 },
  { id: 'aliceai-llm', label: 'Alice AI', maxContext: 65536 },
  { id: 'aliceai-llm-flash', label: 'Alice AI Flash', maxContext: 65536 },
];

export const DEFAULT_MODEL_ID = 'qwen3-235b-a22b-fp8';

export function getModel(id: string): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}
