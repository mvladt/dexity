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
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({ title }),
  });
  const data = await res.json() as { id: number };
  return data.id;
}

async function deleteChatViaApi(chatId: number): Promise<void> {
  await fetch(`${API_URL}/api/chats/${chatId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });
}

test.describe('ContextIndicator — #8/#9 from aikit-improvements-plan', () => {

  // ---------------------------------------------------------------
  // Test 1: Empty state does NOT show ContextIndicator
  // ---------------------------------------------------------------
  test('Empty state (/chat without active chat) does not render ContextIndicator', async ({ page }) => {
    await loginAndNavigate(page, `${BASE_URL}/chat`);

    // Ensure we are on the empty state (no active chat)
    await expect(page).toHaveURL(`${BASE_URL}/chat`);

    await page.screenshot({ path: `${SCREENSHOTS}/ci-01-empty-state.png`, fullPage: true });

    // ContextIndicator should not be present at all
    const indicator = page.locator('.g-aikit-context-indicator__container');
    await expect(indicator).not.toBeVisible();
  });

  // ---------------------------------------------------------------
  // Test 2: Active (empty) chat shows ContextIndicator with value 0
  // ---------------------------------------------------------------
  test('Active chat with no messages renders ContextIndicator at 0%', async ({ page }) => {
    const chatId = await createChatViaApi(`CI-test-empty-${crypto.randomUUID().slice(0, 8)}`);

    try {
      await loginAndNavigate(page, `${BASE_URL}/chat/${chatId}`);

      const indicator = page.locator('.g-aikit-context-indicator__container');
      await expect(indicator).toBeVisible();

      // Value should be 0 (no messages → 0 tokens used)
      const value = page.locator('.g-aikit-context-indicator__value');
      await expect(value).toBeVisible();
      await expect(value).toHaveText('0');

      await page.screenshot({ path: `${SCREENSHOTS}/ci-02-empty-chat-indicator.png`, fullPage: true });
    } finally {
      await deleteChatViaApi(chatId).catch(() => {});
    }
  });

  // ---------------------------------------------------------------
  // Test 3: After optimistic user message indicator grows above 0
  // ---------------------------------------------------------------
  test('Indicator value grows above 0 after user sends a message', async ({ page }) => {
    const chatId = await createChatViaApi(`CI-test-msg-${crypto.randomUUID().slice(0, 8)}`);

    try {
      await loginAndNavigate(page, `${BASE_URL}/chat/${chatId}`);

      // Confirm indicator starts at 0
      const value = page.locator('.g-aikit-context-indicator__value');
      await expect(value).toHaveText('0');

      // Use a long message so the estimated token count rounds to ≥ 1%
      // Formula: Math.ceil(len/3) tokens; to get ≥ 1% of 8000 need ≥ 40 tokens → ≥ 120 chars
      const longMessage =
        'Расскажи подробно и развёрнуто об истории освоения космоса: ' +
        'от первых спутников и полётов человека в космос до современных миссий на МКС, ' +
        'планов полётов на Луну и Марс, а также перспектив межзвёздных путешествий в далёком будущем.';

      const textarea = page.getByRole('textbox');
      await textarea.fill(longMessage);

      // Screenshot before sending
      await page.screenshot({ path: `${SCREENSHOTS}/ci-03-before-send.png`, fullPage: true });

      // Submit (Enter key or click submit button)
      await textarea.press('Enter');

      // Wait for optimistic message to appear in the store / UI — no need to wait for LLM
      // The optimistic message is added synchronously in handleUserMessage before startStream
      // Wait briefly for React to re-render
      await page.waitForTimeout(300);

      await page.screenshot({ path: `${SCREENSHOTS}/ci-04-after-send.png`, fullPage: true });

      // Indicator must now show a value > 0
      // Note: the '%' sign is added by CSS ::after pseudo-element and is NOT part of textContent
      const currentValue = await value.textContent();
      const numericValue = parseInt(currentValue ?? '0', 10);
      expect(numericValue, `Expected indicator value > 0, got "${currentValue}"`).toBeGreaterThan(0);
    } finally {
      await deleteChatViaApi(chatId).catch(() => {});
    }
  });

  // ---------------------------------------------------------------
  // Test 4: Tooltip contains expected text
  // ---------------------------------------------------------------
  test('ContextIndicator tooltip contains "Использовано" and "токенов"', async ({ page }) => {
    const chatId = await createChatViaApi(`CI-test-tooltip-${crypto.randomUUID().slice(0, 8)}`);

    try {
      await loginAndNavigate(page, `${BASE_URL}/chat/${chatId}`);

      const indicator = page.locator('.g-aikit-context-indicator__container');
      await expect(indicator).toBeVisible();

      // Hover to trigger tooltip
      await indicator.hover();

      // @gravity-ui/uikit Tooltip renders into a portal — look for it in the document
      const tooltip = page.locator('[class*="g-tooltip"]');
      await expect(tooltip).toBeVisible({ timeout: 3000 });

      const tooltipText = await tooltip.textContent();
      expect(tooltipText, 'Tooltip should mention "Использовано"').toContain('Использовано');
      expect(tooltipText, 'Tooltip should mention "токенов"').toContain('токенов');

      await page.screenshot({ path: `${SCREENSHOTS}/ci-05-tooltip.png`, fullPage: true });
    } finally {
      await deleteChatViaApi(chatId).catch(() => {});
    }
  });

  // ---------------------------------------------------------------
  // Test 5: Regression — submit button has data-qa="submit-button-full" in active chat
  // ---------------------------------------------------------------
  test('Submit button in active chat has data-qa="submit-button-full" (view="full" regression)', async ({ page }) => {
    const chatId = await createChatViaApi(`CI-test-btn-${crypto.randomUUID().slice(0, 8)}`);

    try {
      await loginAndNavigate(page, `${BASE_URL}/chat/${chatId}`);

      // The submit button rendered by PromptInputFull should carry submit-button-full qa
      const submitBtn = page.locator('[data-qa="submit-button-full"]');
      await expect(submitBtn).toBeVisible();

      await page.screenshot({ path: `${SCREENSHOTS}/ci-06-submit-button.png`, fullPage: true });
    } finally {
      await deleteChatViaApi(chatId).catch(() => {});
    }
  });

});
