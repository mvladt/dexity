import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3001';
const TOKEN = 'kakako';

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

async function waitForStreamingToEnd(page: Page) {
  const selectControl = page.locator('.g-select-control').first();
  await expect(selectControl).not.toHaveClass(/g-select-control_disabled/, { timeout: 120_000 });
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('ChatComposer — view="full" layout', () => {

  // =========================================================================
  // 1. Empty-state: / (no active chat)
  // =========================================================================
  test.describe('Empty-state (/chat — no active chat)', () => {

    test('Uses full view submit button; model Select is inside PromptInput footer', async ({ page }) => {
      await loginAndNavigate(page);

      // Full view renders data-qa="submit-button-full"; simple view would be "submit-button-simple"
      await expect(page.locator('[data-qa="submit-button-full"]')).toBeVisible();
      await expect(page.locator('[data-qa="submit-button-simple"]')).not.toBeVisible();

      // Our custom footer div (bottomContent) is inside the PromptInput full view footer
      const composerFooter = page.locator('.g-aikit-prompt-input-footer .chat-composer-footer');
      await expect(composerFooter).toBeVisible();

      // Model Select is inside that footer
      await expect(composerFooter.locator('.g-select-control').first()).toBeVisible();

      // Old external footer is gone
      await expect(page.locator('.chat-input-footer')).not.toBeVisible();
    });

    test('ContextIndicator is NOT visible in empty-state (no context yet)', async ({ page }) => {
      await loginAndNavigate(page);

      // No ContextIndicator header should be rendered at all
      const header = page.locator('.g-aikit-prompt-input-header');
      await expect(header).not.toBeVisible();

      const indicator = page.locator('.g-aikit-context-indicator__container');
      await expect(indicator).not.toBeVisible();
    });
  });

  // =========================================================================
  // 2. Active chat: ContextIndicator appears in the header of PromptInput
  // =========================================================================
  test.describe('Active chat (/chat/:id)', () => {

    test('ContextIndicator is visible inside PromptInput header after opening a chat', async ({ page }) => {
      const chatId = await createChatViaApi(`fullview-ci-${crypto.randomUUID().slice(0, 8)}`);
      try {
        await loginAndNavigate(page, `${BASE_URL}/chat/${chatId}`);

        // Header section of PromptInput full view is visible
        const promptInputHeader = page.locator('.g-aikit-prompt-input-header');
        await expect(promptInputHeader).toBeVisible();

        // ContextIndicator is inside the header (even with 0 tokens, it renders)
        const indicator = promptInputHeader.locator('.g-aikit-context-indicator__container');
        await expect(indicator).toBeVisible();

        // Model Select is in the footer (not the header)
        const composerFooter = page.locator('.g-aikit-prompt-input-footer .chat-composer-footer');
        await expect(composerFooter).toBeVisible();
        await expect(composerFooter.locator('.g-select-control').first()).toBeVisible();
      } finally {
        await deleteChatViaApi(chatId).catch(() => {});
      }
    });
  });

  // =========================================================================
  // 3. Model selector works inside the PromptInput footer
  // =========================================================================
  test.describe('Model selector inside PromptInput footer', () => {

    test('Changing model via the Select inside PromptInput footer updates the displayed label', async ({ page }) => {
      await loginAndNavigate(page);

      const composerFooter = page.locator('.g-aikit-prompt-input-footer .chat-composer-footer');
      const selectControl = composerFooter.locator('.g-select-control').first();
      await expect(selectControl).toBeVisible();

      // Open the select
      await selectControl.click();
      const popup = page.locator('.g-select-popup').first();
      await expect(popup).toBeVisible({ timeout: 5000 });

      // Pick a model that is different from the default (Qwen3 235B)
      await popup.locator('.g-select-list__option-default-label', { hasText: 'YandexGPT Lite' }).click();
      await expect(popup).not.toBeVisible({ timeout: 3000 });

      // Label in the select now reflects the choice
      const label = composerFooter.locator('.g-select-control__option-text').first();
      await expect(label).toHaveText(/YandexGPT Lite/i);

      // Restore default
      await selectControl.click();
      const popup2 = page.locator('.g-select-popup').first();
      await expect(popup2).toBeVisible({ timeout: 5000 });
      await popup2.locator('.g-select-list__option-default-label', { hasText: 'Qwen3 235B' }).click();
    });
  });

  // =========================================================================
  // 4. Mobile: Select and input remain usable at 375px
  // =========================================================================
  test.describe('Mobile viewport (375x667)', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('Select is visible and textarea accepts input at 375px', async ({ page }) => {
      await loginAndNavigate(page);

      // The full view submit button is still present
      await expect(page.locator('[data-qa="submit-button-full"]')).toBeVisible();

      // Model Select is visible inside the footer
      const composerFooter = page.locator('.g-aikit-prompt-input-footer .chat-composer-footer');
      await expect(composerFooter).toBeVisible();
      await expect(composerFooter.locator('.g-select-control').first()).toBeVisible();

      // Textarea is functional — can type a message
      const textarea = page.getByRole('textbox');
      await expect(textarea).toBeVisible();
      await textarea.fill('Тест мобильного ввода');
      await expect(textarea).toHaveValue('Тест мобильного ввода');
    });
  });

  // =========================================================================
  // 5. Regression: POST /messages/stream still includes "model" in body
  // =========================================================================
  test.describe('Regression — model field in stream POST body', () => {

    test('POST /api/chats/:id/messages/stream includes "model" field', async ({ page }) => {
      const chatId = await createChatViaApi(`fullview-model-${crypto.randomUUID().slice(0, 8)}`);
      try {
        await loginAndNavigate(page, `${BASE_URL}/chat/${chatId}`);

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

        await page.waitForTimeout(1500);

        expect(capturedBody, 'Stream request should have been captured').not.toBeNull();
        expect(
          capturedBody!['model'],
          `"model" should be present in POST body, got: ${JSON.stringify(capturedBody)}`,
        ).toBeTruthy();
      } finally {
        await waitForStreamingToEnd(page).catch(() => {});
        await deleteChatViaApi(chatId).catch(() => {});
      }
    });
  });
});
