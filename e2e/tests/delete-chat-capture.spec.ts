/**
 * Captures console errors and full network details for the delete bug report.
 * Runs with verbose logging — does NOT assert, just records everything.
 */
import { test } from '@playwright/test';
import * as path from 'path';

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3001';
const TOKEN = 'kakako';
const SCREENSHOTS = path.join(__dirname, '../screenshots');

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

test('Capture all console output and network details during chat deletion', async ({ page }) => {
  const chatTitle = `Bug Capture ${crypto.randomUUID().slice(0, 8)}`;
  const chatId = await createChatViaApi(chatTitle);

  const allConsole: string[] = [];
  const networkLog: string[] = [];

  // Capture ALL console messages
  page.on('console', (msg) => {
    allConsole.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    allConsole.push(`[pageerror] ${err.message}`);
  });

  // Capture ALL network requests/responses involving chats
  page.on('request', (req) => {
    if (req.url().includes('/api/')) {
      networkLog.push(`-> ${req.method()} ${req.url()} headers: ${JSON.stringify(req.headers())}`);
    }
  });
  page.on('response', async (res) => {
    if (res.url().includes('/api/')) {
      let body = '';
      try { body = await res.text(); } catch { body = '<unreadable>'; }
      networkLog.push(`<- ${res.status()} ${res.url()} body: ${body.slice(0, 500)}`);
    }
  });

  // Set auth token
  await page.goto(`${BASE_URL}/login`);
  await page.evaluate((token) => {
    localStorage.setItem('auth-token', JSON.stringify({ state: { token }, version: 0 }));
  }, TOKEN);

  // Navigate to the chat
  await page.goto(`${BASE_URL}/chat/${chatId}`);
  await page.waitForLoadState('networkidle');

  await page.screenshot({ path: `${SCREENSHOTS}/capture-01-initial.png`, fullPage: true });

  // Find and click the delete button
  const listItem = page.locator('[role="listitem"]').filter({ hasText: chatTitle });
  await listItem.hover();

  await page.screenshot({ path: `${SCREENSHOTS}/capture-02-hover.png`, fullPage: true });

  const deleteBtn = listItem.locator('.g-aikit-history__delete-button');
  await deleteBtn.click({ force: true }); // force to bypass visibility check

  await page.waitForTimeout(2000);

  await page.screenshot({ path: `${SCREENSHOTS}/capture-03-after-delete.png`, fullPage: true });

  console.log('\n========== NETWORK LOG ==========');
  networkLog.forEach((entry) => console.log(entry));

  console.log('\n========== CONSOLE LOG ==========');
  allConsole.forEach((entry) => console.log(entry));

  // Clean up
  await deleteChatViaApi(chatId).catch(() => {});
});
