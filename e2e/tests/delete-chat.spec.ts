import { test, expect, Page, Request, Response } from '@playwright/test';
import * as path from 'path';

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3001';
const TOKEN = 'kakako';
const SCREENSHOTS = path.join(__dirname, '../screenshots');

async function loginAndNavigate(page: Page, url = `${BASE_URL}/chat`) {
  await page.goto(`${BASE_URL}/login`);
  // Zustand persist stores token under key 'auth-token' as JSON: {state: {token}, version: 0}
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

interface NetworkRecord {
  method: string;
  url: string;
  status: number | null;
  responseBody: string | null;
}

function interceptDeleteRequests(page: Page): NetworkRecord[] {
  const records: NetworkRecord[] = [];
  page.on('request', (req: Request) => {
    if (req.method() === 'DELETE' && req.url().includes('/api/chats/')) {
      records.push({ method: req.method(), url: req.url(), status: null, responseBody: null });
    }
  });
  page.on('response', async (res: Response) => {
    if (res.request().method() === 'DELETE' && res.url().includes('/api/chats/')) {
      const record = records.find((r) => r.url === res.url() && r.status === null);
      if (record) {
        record.status = res.status();
        try { record.responseBody = await res.text(); } catch { record.responseBody = '<unreadable>'; }
      }
    }
  });
  return records;
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`); });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
  return errors;
}

// Find the list item for a specific chat by title
function getChatListItem(page: Page, chatTitle: string) {
  return page.locator('[role="listitem"]').filter({ hasText: chatTitle });
}

// Hover over the chat item then return the delete button locator
async function hoverAndGetDeleteBtn(page: Page, chatTitle: string) {
  const listItem = getChatListItem(page, chatTitle);
  await listItem.hover();
  return listItem.locator('.g-aikit-history__delete-button');
}

test.describe('Chat deletion — scenario 8 (inactive) and 9 (active)', () => {
  let chat1Id: number;
  let chat2Id: number;
  const chat1Title = `Inactive Chat ${crypto.randomUUID().slice(0, 8)}`;
  const chat2Title = `Active Chat ${crypto.randomUUID().slice(0, 8)}`;

  test.beforeAll(async () => {
    chat1Id = await createChatViaApi(chat1Title);
    chat2Id = await createChatViaApi(chat2Title);
  });

  test.afterAll(async () => {
    await deleteChatViaApi(chat1Id).catch(() => {});
    await deleteChatViaApi(chat2Id).catch(() => {});
  });

  test('Scenario 8: Deleting an inactive chat removes it from sidebar without affecting active chat', async ({ page }) => {
    const networkRecords = interceptDeleteRequests(page);
    const consoleErrors = collectConsoleErrors(page);

    // Login and navigate to chat2 (making it the active chat)
    await loginAndNavigate(page, `${BASE_URL}/chat/${chat2Id}`);

    // Verify both chats are visible in sidebar
    await expect(page.getByText(chat1Title)).toBeVisible();
    await expect(page.getByText(chat2Title)).toBeVisible();

    // Verify we are on the active chat2 URL
    await expect(page).toHaveURL(new RegExp(`/chat/${chat2Id}`));

    // Screenshot: initial state — both chats in sidebar, chat2 is active
    await page.screenshot({ path: `${SCREENSHOTS}/s8-01-initial.png`, fullPage: true });

    // Hover over chat1 to reveal delete button, then click it
    const deleteBtn = await hoverAndGetDeleteBtn(page, chat1Title);
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Screenshot: immediately after clicking delete
    await page.screenshot({ path: `${SCREENSHOTS}/s8-02-after-click.png`, fullPage: true });

    // Wait for potential confirmation dialog
    const confirmBtn = page.getByRole('button', { name: /confirm|подтвердить|да|yes|delete|удалить/i }).first();
    const hasConfirm = await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false);
    if (hasConfirm) {
      await page.screenshot({ path: `${SCREENSHOTS}/s8-03-confirm-dialog.png`, fullPage: true });
      await confirmBtn.click();
    }

    // Wait for the network request to complete
    await page.waitForTimeout(1500);

    // Screenshot: final state
    await page.screenshot({ path: `${SCREENSHOTS}/s8-04-final.png`, fullPage: true });

    // --- ASSERTIONS ---

    // 1. DELETE request was sent
    expect(networkRecords.length, 'Expected a DELETE network request to be made').toBeGreaterThan(0);

    // 2. Request targeted the correct chat
    const deleteReq = networkRecords[0];
    expect(deleteReq.url, 'DELETE URL should include the chat id').toContain(`/api/chats/${chat1Id}`);

    // 3. Server responded with 200
    expect(deleteReq.status, `DELETE response status should be 200, got ${deleteReq.status}. Body: ${deleteReq.responseBody}`).toBe(200);

    // 4. chat1 is gone from the sidebar
    await expect(page.getByText(chat1Title)).not.toBeVisible();

    // 5. Active chat (chat2) is still selected and URL unchanged
    await expect(page).toHaveURL(new RegExp(`/chat/${chat2Id}`));
    await expect(page.getByText(chat2Title)).toBeVisible();

    // Log for report
    console.log('=== Scenario 8 Network Records ===');
    console.log(JSON.stringify(networkRecords, null, 2));
    console.log('=== Scenario 8 Console Errors ===');
    console.log(consoleErrors.length ? consoleErrors.join('\n') : 'none');
  });

  test('Scenario 9: Deleting the active chat redirects to /chat with no active chat', async ({ page }) => {
    const networkRecords = interceptDeleteRequests(page);
    const consoleErrors = collectConsoleErrors(page);

    // Login and navigate to chat2 (which should still exist after scenario 8)
    await loginAndNavigate(page, `${BASE_URL}/chat/${chat2Id}`);

    // Verify chat2 is visible and active
    await expect(page.getByText(chat2Title)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/chat/${chat2Id}`));

    // Screenshot: initial state
    await page.screenshot({ path: `${SCREENSHOTS}/s9-01-initial.png`, fullPage: true });

    // Hover over chat2 to reveal delete button, then click it
    const deleteBtn = await hoverAndGetDeleteBtn(page, chat2Title);
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Screenshot: immediately after clicking delete
    await page.screenshot({ path: `${SCREENSHOTS}/s9-02-after-click.png`, fullPage: true });

    // Wait for potential confirmation dialog
    const confirmBtn = page.getByRole('button', { name: /confirm|подтвердить|да|yes|delete|удалить/i }).first();
    const hasConfirm = await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false);
    if (hasConfirm) {
      await page.screenshot({ path: `${SCREENSHOTS}/s9-03-confirm-dialog.png`, fullPage: true });
      await confirmBtn.click();
    }

    // Wait for navigation and network
    await page.waitForTimeout(1500);

    // Screenshot: final state
    await page.screenshot({ path: `${SCREENSHOTS}/s9-04-final.png`, fullPage: true });

    // --- ASSERTIONS ---

    // 1. DELETE request was sent
    expect(networkRecords.length, 'Expected a DELETE network request to be made').toBeGreaterThan(0);

    // 2. Request targeted the correct chat
    const deleteReq = networkRecords[0];
    expect(deleteReq.url, 'DELETE URL should include the chat id').toContain(`/api/chats/${chat2Id}`);

    // 3. Server responded with 200
    expect(deleteReq.status, `DELETE response status should be 200, got ${deleteReq.status}. Body: ${deleteReq.responseBody}`).toBe(200);

    // 4. chat2 is gone from the sidebar
    await expect(page.getByText(chat2Title)).not.toBeVisible();

    // 5. URL should be /chat (no active chat)
    await expect(page).toHaveURL(`${BASE_URL}/chat`);

    // Log for report
    console.log('=== Scenario 9 Network Records ===');
    console.log(JSON.stringify(networkRecords, null, 2));
    console.log('=== Scenario 9 Console Errors ===');
    console.log(consoleErrors.length ? consoleErrors.join('\n') : 'none');
  });
});
