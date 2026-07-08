import { test, expect, Page } from '@playwright/test';
import { getModel, DEFAULT_MODEL_ID } from '../../client/src/models';

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3001';
const TOKEN = 'kakako';
const DEFAULT_MODEL_LABEL = getModel(DEFAULT_MODEL_ID).label;

async function loginAndNavigate(page: Page, url = `${BASE_URL}/chat`) {
  await page.goto(`${BASE_URL}/login`);
  await page.evaluate((token) => {
    localStorage.setItem('auth-token', JSON.stringify({ state: { token }, version: 0 }));
  }, TOKEN);
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

async function createChatViaApi(title: string): Promise<number> {
  const res = await fetch(`${API_URL}/api/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ title }),
  });
  const data = (await res.json()) as { id: number };
  return data.id;
}

async function deleteChatViaApi(chatId: number): Promise<void> {
  await fetch(`${API_URL}/api/chats/${chatId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the currently displayed label text in the model Select. */
async function getSelectedModelLabel(page: Page): Promise<string> {
  const btn = page.locator('.g-select-control__option-text').first();
  await expect(btn).toBeVisible();
  return (await btn.textContent()) ?? '';
}

/** Opens the model select popup and clicks the option matching `label`. */
async function selectModel(page: Page, label: string) {
  const selectControl = page.locator('.g-select-control').first();
  await expect(selectControl).not.toHaveClass(/g-select-control_disabled/, { timeout: 30000 });
  await selectControl.click();
  const popup = page.locator('.g-select-popup').first();
  await expect(popup).toBeVisible({ timeout: 5000 });
  await popup.locator('.g-select-list__option-default-label', { hasText: label }).click();
  await expect(popup).not.toBeVisible({ timeout: 3000 });
}

/** Waits for streaming to complete by checking that Select is no longer disabled. */
async function waitForStreamingToEnd(page: Page) {
  const selectControl = page.locator('.g-select-control').first();
  await expect(selectControl).not.toHaveClass(/g-select-control_disabled/, { timeout: 120000 });
}

/**
 * If streaming is currently active (Select is disabled), navigates away to close the SSE
 * connection and wait for the server to process the abort. Safe to call when not streaming.
 */
async function cancelStreamIfActive(page: Page) {
  const selectControl = page.locator('.g-select-control').first();
  const isStreaming = await selectControl
    .evaluate((el) => el.className.includes('g-select-control_disabled'))
    .catch(() => false);
  if (isStreaming) {
    await page.goto(`${BASE_URL}/chat`).catch(() => {});
    await page.waitForTimeout(500);
  }
}

// ---------------------------------------------------------------------------

test.describe('Model selector & ContextIndicator', () => {
  test.describe('Выбор модели', () => {
    test(`По умолчанию выбрана модель из настроек (${DEFAULT_MODEL_LABEL})`, async ({ page }) => {
      await loginAndNavigate(page);

      const defaultLabel = await getSelectedModelLabel(page);
      expect(defaultLabel, `Дефолтная модель должна быть ${DEFAULT_MODEL_LABEL}`).toContain(
        DEFAULT_MODEL_LABEL,
      );
    });

    test('Выбор модели сохраняется в localStorage (dexity-settings) после перезагрузки', async ({
      page,
    }) => {
      await loginAndNavigate(page);

      await selectModel(page, 'YandexGPT 32k');
      const afterChange = await getSelectedModelLabel(page);
      expect(afterChange).toContain('YandexGPT 32k');

      await page.reload();
      await page.waitForLoadState('networkidle');

      const afterReload = await getSelectedModelLabel(page);
      expect(afterReload, 'Выбор модели должен сохраняться после перезагрузки').toContain(
        'YandexGPT 32k',
      );

      // Восстановить дефолт
      await selectModel(page, DEFAULT_MODEL_LABEL);
      const restored = await getSelectedModelLabel(page);
      expect(restored).toContain(DEFAULT_MODEL_LABEL);
    });
  });

  test.describe('ContextIndicator', () => {
    test('Не отображается, пока нет активного чата', async ({ page }) => {
      await loginAndNavigate(page);

      const indicator = page.locator('.g-aikit-context-indicator__container');
      await expect(indicator).not.toBeVisible();
    });

    test('Процент заполнения контекста растёт при уменьшении maxContext модели (Qwen3 235B vs YandexGPT Lite)', async ({
      page,
    }) => {
      // Стратегия:
      // 1. Отправить сообщение — оптимистичное user-сообщение попадает в стор сразу
      // 2. Тут же отменить стрим, чтобы не ждать реального ответа LLM и разблокировать Select
      // 3. Сравнить % индикатора между Qwen3 (maxContext 32000) и YandexGPT Lite (maxContext 8000)
      const chatId = await createChatViaApi(`ms-ctx-pct-${crypto.randomUUID().slice(0, 8)}`);
      try {
        await loginAndNavigate(page, `${BASE_URL}/chat/${chatId}`);

        await selectModel(page, 'Qwen3 235B');

        // Нужно ≥1% от 32000 = ≥320 токенов = ≥960 символов (estimateTokens = len/3)
        const textarea = page.getByRole('textbox');
        const base =
          'Расскажи мне о принципах работы нейронных сетей и их применении в современном машинном обучении. ' +
          'Опиши основные типы архитектур: сверточные, рекуррентные и трансформеры. ' +
          'Как работает механизм внимания в архитектуре трансформера, какие задачи он решает лучше всего? ' +
          'Что такое предобученные языковые модели и как происходит их дообучение на конкретных задачах? ' +
          'Какие датасеты используются при обучении больших языковых моделей? ' +
          'Расскажи о проблемах галлюцинаций и методах их минимизации. ';
        const longEnough = base.repeat(Math.ceil(960 / base.length) + 1).slice(0, 980);
        await textarea.fill(longEnough);
        await textarea.press('Enter');

        // Отменить сразу — останавливает стриминг и разблокирует Select.
        // Оптимистичное user-сообщение уже в сторе на этот момент.
        const submitBtn = page.locator('[data-qa="submit-button-full"]');
        await expect(submitBtn).toBeVisible({ timeout: 3000 });
        await submitBtn.click();
        await waitForStreamingToEnd(page);

        const valueLocator = page.locator('.g-aikit-context-indicator__value');
        await expect(valueLocator).toBeVisible();

        const valueQwen = parseInt((await valueLocator.textContent()) ?? '0', 10);
        expect(valueQwen, 'Индикатор Qwen3 должен быть > 0 после отправки сообщения').toBeGreaterThan(0);

        await selectModel(page, 'YandexGPT Lite');
        await page.waitForTimeout(200);

        const valueYgpt = parseInt((await valueLocator.textContent()) ?? '0', 10);

        expect(
          valueYgpt,
          `% YandexGPT Lite (${valueYgpt}) должен быть больше % Qwen3 (${valueQwen}) — те же токены, maxContext в 4 раза меньше`,
        ).toBeGreaterThan(valueQwen);
      } finally {
        await cancelStreamIfActive(page);
        await deleteChatViaApi(chatId).catch(() => {});
      }
    });

    test('Тултип показывает maxContext выбранной модели', async ({ page }) => {
      const chatId = await createChatViaApi(`ms-tooltip-${crypto.randomUUID().slice(0, 8)}`);
      try {
        await loginAndNavigate(page, `${BASE_URL}/chat/${chatId}`);

        await selectModel(page, 'YandexGPT Lite');

        const indicator = page.locator('.g-aikit-context-indicator__container');
        await expect(indicator).toBeVisible();
        await indicator.hover();

        const tooltip = page.locator('[class*="g-tooltip"]');
        await expect(tooltip).toBeVisible({ timeout: 3000 });

        const tooltipText = await tooltip.textContent();
        expect(tooltipText, 'Тултип должен упоминать 8000 (maxContext YandexGPT Lite)').toContain('8000');
        expect(tooltipText, 'Тултип должен упоминать "токенов"').toContain('токенов');

        await page.keyboard.press('Escape');
        await selectModel(page, 'Qwen3 235B');
        await indicator.hover();
        await expect(tooltip).toBeVisible({ timeout: 3000 });

        const tooltipQwen = await tooltip.textContent();
        expect(tooltipQwen, 'Тултип должен упоминать 32000 (maxContext Qwen3 235B)').toContain('32000');
      } finally {
        await deleteChatViaApi(chatId).catch(() => {});
      }
    });
  });

  test.describe('Отмена стрима', () => {
    test('Кнопка отмены останавливает генерацию', async ({ page }) => {
      const chatId = await createChatViaApi(`ms-cancel-${crypto.randomUUID().slice(0, 8)}`);
      try {
        await loginAndNavigate(page, `${BASE_URL}/chat/${chatId}`);

        const textarea = page.getByRole('textbox');
        await textarea.fill(
          'Напиши очень длинное эссе об истории Рима, от основания до падения, ' +
            'с подробным описанием всех императоров и ключевых событий.',
        );
        await textarea.press('Enter');

        const submitBtn = page.locator('[data-qa="submit-button-full"]');
        await expect(submitBtn).toBeVisible({ timeout: 5000 });
        await page.waitForTimeout(300);

        await submitBtn.click();

        await waitForStreamingToEnd(page);
        await expect(submitBtn).toBeVisible();
      } finally {
        await cancelStreamIfActive(page);
        await deleteChatViaApi(chatId).catch(() => {});
      }
    });
  });
});
