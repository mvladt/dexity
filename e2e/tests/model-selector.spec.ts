import { test, expect, Page } from '@playwright/test';
import * as path from 'path';

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3001';
const TOKEN = 'kakako';
const SCREENSHOTS = path.join(__dirname, '../screenshots');

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
  // Use the first select control on the page (model selector)
  const selectControl = page.locator('.g-select-control').first();
  // Wait until not disabled (disabled is indicated by g-select-control_disabled CSS class)
  await expect(selectControl).not.toHaveClass(/g-select-control_disabled/, { timeout: 30000 });
  await selectControl.click();
  // The popup has class g-select-popup; wait for any option to appear
  const popup = page.locator('.g-select-popup').first();
  await expect(popup).toBeVisible({ timeout: 5000 });
  // Click the option inside the popup (avoids strict-mode violation with the control label)
  await popup.locator('.g-select-list__option-default-label', { hasText: label }).click();
  // Popup should close
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
  const isStreaming = await selectControl.evaluate((el) =>
    el.className.includes('g-select-control_disabled'),
  ).catch(() => false);
  if (isStreaming) {
    // Navigate away — this closes the SSE connection and triggers server abort
    await page.goto(`${BASE_URL}/chat`).catch(() => {});
    // Give the server time to process the close event
    await page.waitForTimeout(500);
  }
}

// ---------------------------------------------------------------------------
test.describe('PromptInput layout & Model Selector — commit 617938a', () => {

  // =========================================================================
  // 1. Empty-state layout
  // =========================================================================
  test.describe('Empty-state (/chat without active chat)', () => {

    test('PromptInput is in simple view (no submit-button-full)', async ({ page }) => {
      await loginAndNavigate(page);

      // simple view has submit-button-simple; full view would have submit-button-full
      const simpleBtn = page.locator('[data-qa="submit-button-simple"]');
      const fullBtn = page.locator('[data-qa="submit-button-full"]');

      await expect(simpleBtn).toBeVisible();
      await expect(fullBtn).not.toBeVisible();

      await page.screenshot({ path: `${SCREENSHOTS}/ms-01-empty-simple-view.png`, fullPage: true });
    });

    test('Footer row is visible under PromptInput: Select + Disclaimer + empty spacer', async ({ page }) => {
      await loginAndNavigate(page);

      const footer = page.locator('.chat-input-footer');
      await expect(footer).toBeVisible();

      // Select is first child
      const select = footer.locator('.g-select-control').first();
      await expect(select).toBeVisible();

      // Disclaimer text
      await expect(footer.getByText(/AI может ошибаться/i)).toBeVisible();

      await page.screenshot({ path: `${SCREENSHOTS}/ms-02-empty-footer.png`, fullPage: true });
    });

    test('Select shows 6 model options, default is "Qwen3 235B"', async ({ page }) => {
      await loginAndNavigate(page);

      // Default label
      const defaultLabel = await getSelectedModelLabel(page);
      expect(defaultLabel, 'Default model should be Qwen3 235B').toContain('Qwen3 235B');

      // Open select and count options
      const selectControl = page.locator('.g-select-control').first();
      await selectControl.click();
      const popup = page.locator('.g-select-popup').first();
      await expect(popup).toBeVisible({ timeout: 5000 });

      // g-select renders items with class g-select-list__option-default-label inside wrappers
      const options = popup.locator('.g-select-list__option-default-label');
      await expect(options).toHaveCount(6, { timeout: 3000 });

      await page.screenshot({ path: `${SCREENSHOTS}/ms-03-empty-select-open.png`, fullPage: true });
      // Close popup
      await page.keyboard.press('Escape');
    });

    test('Model selection persists to localStorage (dexity-settings) across reload', async ({ page }) => {
      await loginAndNavigate(page);

      // Change model to YandexGPT 32k
      await selectModel(page, 'YandexGPT 32k');
      const afterChange = await getSelectedModelLabel(page);
      expect(afterChange).toContain('YandexGPT 32k');

      await page.screenshot({ path: `${SCREENSHOTS}/ms-04-after-model-change.png`, fullPage: true });

      // Reload
      await page.reload();
      await page.waitForLoadState('networkidle');

      const afterReload = await getSelectedModelLabel(page);
      expect(afterReload, 'Model selection should persist after reload').toContain('YandexGPT 32k');

      await page.screenshot({ path: `${SCREENSHOTS}/ms-05-after-reload-persisted.png`, fullPage: true });

      // Restore default
      await selectModel(page, 'Qwen3 235B');
      const restored = await getSelectedModelLabel(page);
      expect(restored).toContain('Qwen3 235B');
    });

    test('ContextIndicator is NOT visible in empty-state', async ({ page }) => {
      await loginAndNavigate(page);

      const indicator = page.locator('.g-aikit-context-indicator__container');
      await expect(indicator).not.toBeVisible();
    });
  });

  // =========================================================================
  // 2. Active chat layout & ContextIndicator
  // =========================================================================
  test.describe('Active chat (/chat/:id)', () => {

    test('Submit button uses simple view (data-qa="submit-button-simple"), not full', async ({ page }) => {
      const chatId = await createChatViaApi(`ms-layout-${crypto.randomUUID().slice(0, 8)}`);
      try {
        await loginAndNavigate(page, `${BASE_URL}/chat/${chatId}`);

        const simpleBtn = page.locator('[data-qa="submit-button-simple"]');
        const fullBtn = page.locator('[data-qa="submit-button-full"]');

        await expect(simpleBtn).toBeVisible();
        await expect(fullBtn).not.toBeVisible();

        await page.screenshot({ path: `${SCREENSHOTS}/ms-06-active-simple-btn.png`, fullPage: true });
      } finally {
        await deleteChatViaApi(chatId).catch(() => {});
      }
    });

    test('Footer row in active chat has ContextIndicator on the right', async ({ page }) => {
      const chatId = await createChatViaApi(`ms-ci-right-${crypto.randomUUID().slice(0, 8)}`);
      try {
        await loginAndNavigate(page, `${BASE_URL}/chat/${chatId}`);

        const footer = page.locator('.chat-input-footer');
        await expect(footer).toBeVisible();

        const indicator = footer.locator('.g-aikit-context-indicator__container');
        await expect(indicator).toBeVisible();

        await page.screenshot({ path: `${SCREENSHOTS}/ms-07-active-ci-visible.png`, fullPage: true });
      } finally {
        await deleteChatViaApi(chatId).catch(() => {});
      }
    });

    test('ContextIndicator % changes when model maxContext changes (Qwen3 235B vs YandexGPT Lite)', async ({ page }) => {
      // Strategy:
      // 1. Send a message — the optimistic user message lands in the store immediately
      // 2. Cancel the stream right away to avoid long LLM wait and re-enable the Select
      // 3. Compare indicator % between Qwen3 (maxContext 32000) and YandexGPT Lite (maxContext 8000)
      const chatId = await createChatViaApi(`ms-ctx-pct-${crypto.randomUUID().slice(0, 8)}`);
      try {
        await loginAndNavigate(page, `${BASE_URL}/chat/${chatId}`);

        // Ensure we start with Qwen3 235B (maxContext 32000)
        await selectModel(page, 'Qwen3 235B');

        // Send a long message: need ≥1% of 32000 = ≥320 tokens = ≥960 chars
        // estimateTokens = Math.ceil(len/3)
        // We repeat enough text to guarantee len ≥ 960 chars (320 tokens → 1% of 32000)
        const textarea = page.getByRole('textbox');
        const base =
          'Расскажи мне о принципах работы нейронных сетей и их применении в современном машинном обучении. ' +
          'Опиши основные типы архитектур: сверточные, рекуррентные и трансформеры. ' +
          'Как работает механизм внимания в архитектуре трансформера, какие задачи он решает лучше всего? ' +
          'Что такое предобученные языковые модели и как происходит их дообучение на конкретных задачах? ' +
          'Какие датасеты используются при обучении больших языковых моделей? ' +
          'Расскажи о проблемах галлюцинаций и методах их минимизации. ';
        // Repeat until ≥960 chars
        const longEnough = base.repeat(Math.ceil(960 / base.length) + 1).slice(0, 980);
        await textarea.fill(longEnough);
        await textarea.press('Enter');

        // Cancel immediately — stops streaming and re-enables the Select
        // The optimistic user message is already in the store at this point
        const submitBtn = page.locator('[data-qa="submit-button-simple"]');
        await expect(submitBtn).toBeVisible({ timeout: 3000 });
        await submitBtn.click(); // cancel during streaming
        await waitForStreamingToEnd(page);

        const valueLocator = page.locator('.g-aikit-context-indicator__value');
        await expect(valueLocator).toBeVisible();

        const valueQwen = parseInt((await valueLocator.textContent()) ?? '0', 10);
        expect(valueQwen, 'Qwen3 indicator should be > 0 after sending a message').toBeGreaterThan(0);

        await page.screenshot({ path: `${SCREENSHOTS}/ms-08-ctx-qwen.png`, fullPage: true });

        // Switch to YandexGPT Lite (maxContext 8000 — 4x smaller than Qwen3's 32000)
        await selectModel(page, 'YandexGPT Lite');
        await page.waitForTimeout(200);

        const valueYgpt = parseInt((await valueLocator.textContent()) ?? '0', 10);

        await page.screenshot({ path: `${SCREENSHOTS}/ms-09-ctx-ygpt-lite.png`, fullPage: true });

        // Same messages → smaller maxContext → higher percentage
        expect(
          valueYgpt,
          `YandexGPT Lite % (${valueYgpt}) should be > Qwen3 % (${valueQwen}) for same tokens with 4x smaller maxContext`,
        ).toBeGreaterThan(valueQwen);
      } finally {
        await cancelStreamIfActive(page);
        await deleteChatViaApi(chatId).catch(() => {});
      }
    });

    test('ContextIndicator tooltip contains maxContext of selected model', async ({ page }) => {
      const chatId = await createChatViaApi(`ms-tooltip-${crypto.randomUUID().slice(0, 8)}`);
      try {
        await loginAndNavigate(page, `${BASE_URL}/chat/${chatId}`);

        // Use YandexGPT Lite — maxContext 8000
        await selectModel(page, 'YandexGPT Lite');

        const indicator = page.locator('.g-aikit-context-indicator__container');
        await expect(indicator).toBeVisible();
        await indicator.hover();

        const tooltip = page.locator('[class*="g-tooltip"]');
        await expect(tooltip).toBeVisible({ timeout: 3000 });

        const tooltipText = await tooltip.textContent();
        expect(tooltipText, 'Tooltip should mention 8000 (maxContext for YandexGPT Lite)').toContain('8000');
        expect(tooltipText, 'Tooltip should mention "токенов"').toContain('токенов');

        await page.screenshot({ path: `${SCREENSHOTS}/ms-10-tooltip-ygpt.png`, fullPage: true });

        // Switch to Qwen3 235B — maxContext 32000
        await page.keyboard.press('Escape');
        await selectModel(page, 'Qwen3 235B');
        await indicator.hover();
        await expect(tooltip).toBeVisible({ timeout: 3000 });

        const tooltipQwen = await tooltip.textContent();
        expect(tooltipQwen, 'Tooltip should mention 32000 (maxContext for Qwen3 235B)').toContain('32000');

        await page.screenshot({ path: `${SCREENSHOTS}/ms-11-tooltip-qwen.png`, fullPage: true });
      } finally {
        await deleteChatViaApi(chatId).catch(() => {});
      }
    });
  });

  // =========================================================================
  // 3. Regression: model is sent in stream request body
  // =========================================================================
  test.describe('Regression — model field in stream POST body', () => {

    test('POST /api/chats/:id/messages/stream includes "model" in request body', async ({ page }) => {
      const chatId = await createChatViaApi(`ms-model-body-${crypto.randomUUID().slice(0, 8)}`);
      try {
        await loginAndNavigate(page, `${BASE_URL}/chat/${chatId}`);

        // Ensure a known model is selected
        await selectModel(page, 'YandexGPT Lite');

        let capturedBody: Record<string, unknown> | null = null;
        page.on('request', (req) => {
          if (req.method() === 'POST' && req.url().includes('/messages/stream')) {
            try {
              capturedBody = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>;
            } catch {
              capturedBody = {};
            }
          }
        });

        const textarea = page.getByRole('textbox');
        await textarea.fill('Привет!');
        await textarea.press('Enter');

        // Wait for the request to be captured
        await page.waitForTimeout(1500);

        expect(capturedBody, 'Stream request should have been captured').not.toBeNull();
        expect(
          capturedBody!['model'],
          `"model" field should be present in POST body, got: ${JSON.stringify(capturedBody)}`,
        ).toBe('yandexgpt-lite');

        await page.screenshot({ path: `${SCREENSHOTS}/ms-12-model-in-body.png`, fullPage: true });
      } finally {
        await cancelStreamIfActive(page);
        await deleteChatViaApi(chatId).catch(() => {});
      }
    });
  });

  // =========================================================================
  // 4. Regression: cancel during streaming works with simple view
  // =========================================================================
  test.describe('Regression — cancel button during stream (simple view)', () => {

    test('Cancel button appears during stream and stops it', async ({ page }) => {
      const chatId = await createChatViaApi(`ms-cancel-${crypto.randomUUID().slice(0, 8)}`);
      try {
        await loginAndNavigate(page, `${BASE_URL}/chat/${chatId}`);

        const textarea = page.getByRole('textbox');
        await textarea.fill(
          'Напиши очень длинное эссе об истории Рима, от основания до падения, ' +
          'с подробным описанием всех императоров и ключевых событий.',
        );
        await textarea.press('Enter');

        // During streaming the submit-button-simple should become a cancel button
        // PromptInput simple view uses data-qa="submit-button-simple" for both states
        const submitBtn = page.locator('[data-qa="submit-button-simple"]');
        await expect(submitBtn).toBeVisible({ timeout: 5000 });

        // Wait for streaming state to kick in
        await page.waitForTimeout(300);

        // Click cancel
        await submitBtn.click();

        // After cancel, streaming should stop (button becomes normal send again quickly)
        await waitForStreamingToEnd(page);
        await expect(submitBtn).toBeVisible();

        await page.screenshot({ path: `${SCREENSHOTS}/ms-13-after-cancel.png`, fullPage: true });
      } finally {
        await cancelStreamIfActive(page);
        await deleteChatViaApi(chatId).catch(() => {});
      }
    });
  });

  // =========================================================================
  // 5. Mobile/responsive — footer does not break at 375px
  // =========================================================================
  test.describe('Mobile responsive (375x667)', () => {

    test('Footer row is visible and not overflowing at 375px viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await loginAndNavigate(page);

      const footer = page.locator('.chat-input-footer');
      await expect(footer).toBeVisible();

      // Select and Disclaimer should both be visible
      await expect(footer.locator('.g-select-control').first()).toBeVisible();
      await expect(footer.getByText(/AI може/i)).toBeVisible();

      // Footer bounding box must be within viewport width
      const box = await footer.boundingBox();
      expect(box, 'Footer bounding box should exist').not.toBeNull();
      expect(box!.width, 'Footer should not overflow viewport').toBeLessThanOrEqual(375);

      await page.screenshot({ path: `${SCREENSHOTS}/ms-14-mobile-footer.png`, fullPage: true });
    });
  });
});
