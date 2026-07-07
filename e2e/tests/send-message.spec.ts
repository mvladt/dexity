import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3001';
const TOKEN = 'kakako';

async function loginAndNavigate(page: Page, url: string) {
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

// Собирает SSE-тело по протоколу сервера (см. server/src/routes/messages.ts, writeSSE):
// каждое событие — строка `data: <json>` с пустой строкой-разделителем.
function buildSSEBody(events: object[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
}

test.describe('Отправка сообщения (мокнутый LLM-ответ)', () => {
  test('После отправки сообщения в чате появляется текст ответа ассистента', async ({ page }) => {
    const chatId = await createChatViaApi(`send-msg-${crypto.randomUUID().slice(0, 8)}`);
    const answerText = 'Тестовый ответ ассистента';

    try {
      await page.route('**/messages/stream', async (route) => {
        const body = buildSSEBody([
          { type: 'delta', delta: answerText },
          { type: 'done', fullContent: answerText, assistantMessageId: 999999 },
        ]);
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body,
        });
      });

      await loginAndNavigate(page, `${BASE_URL}/chat/${chatId}`);

      const textarea = page.getByRole('textbox');
      await textarea.fill('Привет!');
      await textarea.press('Enter');

      await expect(page.getByText(answerText)).toBeVisible();
    } finally {
      await deleteChatViaApi(chatId).catch(() => {});
    }
  });
});
