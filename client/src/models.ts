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
];

export const DEFAULT_MODEL_ID = 'qwen3-235b-a22b-fp8';

export function getModel(id: string): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}
