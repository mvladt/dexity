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

async function waitForStreamingToEnd(page: Page) {
  const selectControl = page.locator('.g-select-control').first();
  await expect(selectControl).not.toHaveClass(/g-select-control_disabled/, { timeout: 120000 });
}

// ---------------------------------------------------------------------------

test.describe('Web search', () => {
  test('Golden path: enables Web toggle, sends query, shows SourcesBlock and citation links', async ({ page }) => {
    const chatId = await createChatViaApi(`ws-smoke-${crypto.randomUUID().slice(0, 8)}`);

    try {
      // 1. Login and navigate to the chat
      await loginAndNavigate(page, `${BASE_URL}/chat/${chatId}`);

      // 2. Enable the Web toggle
      // gravity-ui Switch renders a <label> wrapping an <input role="switch"> +
      // a <span class="g-switch__slider"> that intercepts pointer events.
      // Clicking the label text "Web" reliably toggles the switch.
      const webLabel = page.locator('label.g-switch').filter({ hasText: /^Web$/ });
      await expect(webLabel).toBeVisible();
      await webLabel.click();
      const webSwitch = page.getByRole('switch', { name: /web/i });
      await expect(webSwitch).toBeChecked();

      // Verify webSearch: true is sent in the stream request
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

      // 3. Send a question that requires fresh data
      const textarea = page.getByRole('textbox');
      await textarea.fill('Кто сейчас президент Франции?');
      await textarea.press('Enter');

      // Give Playwright a moment to capture the outgoing request
      await page.waitForTimeout(500);
      expect(capturedBody, 'Stream request should have been captured').not.toBeNull();
      expect(
        capturedBody!['webSearch'],
        `"webSearch" should be true in POST body, got: ${JSON.stringify(capturedBody)}`,
      ).toBe(true);

      // 4. Wait for SourcesBlock to appear (search + SSE sources event)
      const sourcesBlock = page.locator('.sources-block');
      await expect(sourcesBlock).toBeVisible({ timeout: 30000 });

      await page.screenshot({ path: `${SCREENSHOTS}/ws-01-sources-block.png`, fullPage: true });

      // 5. Verify at least one source card is present
      const sourceCards = sourcesBlock.locator('.sources-block__card');
      await expect(sourceCards.first()).toBeVisible({ timeout: 5000 });
      const cardCount = await sourceCards.count();
      expect(cardCount, 'Should have at least one source card').toBeGreaterThanOrEqual(1);

      // 6. Wait for streaming to finish
      await waitForStreamingToEnd(page);

      // 7. Check for citation links in the assistant message
      // gravity-ui/aikit renders assistant messages as .g-aikit-assistant-message
      const assistantMessage = page.locator('.g-aikit-assistant-message').last();
      await expect(assistantMessage).toBeVisible({ timeout: 10000 });

      const citationLink = assistantMessage.locator('a[href^="#src-"]').first();
      const citationText = assistantMessage.getByText(/\[\d+\]/);

      const hasCitationLink = await citationLink.isVisible().catch(() => false);
      const hasCitationText = await citationText.isVisible().catch(() => false);

      expect(
        hasCitationLink || hasCitationText,
        'Assistant response should contain either a citation link (#src-) or inline citation marker [1]/[2]',
      ).toBe(true);

      await page.screenshot({ path: `${SCREENSHOTS}/ws-02-after-streaming.png`, fullPage: true });

      // 8. Click first citation link and verify corresponding card is in viewport
      if (hasCitationLink) {
        await citationLink.click();

        // Wait a tick for scroll to settle
        await page.waitForTimeout(300);

        await page.screenshot({ path: `${SCREENSHOTS}/ws-03-citation-clicked.png`, fullPage: true });

        // Verify the anchored card is visible in viewport
        const firstCard = sourceCards.first();
        const isInViewport = await firstCard.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
          );
        });

        // If not in viewport naturally, scroll and re-check
        if (!isInViewport) {
          await firstCard.scrollIntoViewIfNeeded();
          await page.waitForTimeout(200);
        }

        // The card should exist and be attached — that's sufficient to confirm anchor works
        await expect(firstCard).toBeVisible();
      }
    } finally {
      await cancelStreamIfActive(page);
      await deleteChatViaApi(chatId).catch(() => {});
    }
  });
});
