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

// HistoryPage не вызывает fetchChats() сам — это делает только ChatPage при монтировании.
// Переходим на /history клиентским роутингом (клик по NavLink), иначе полный page.goto
// сбросит Zustand-стор и список активного чата потеряется.
async function navigateToHistoryKeepingActive(page: Page, activeChatId: number) {
  await loginAndNavigate(page, `${BASE_URL}/chat/${activeChatId}`);
  await page.locator('.app-nav-desktop').getByText('История').click();
  await page.waitForURL(`${BASE_URL}/history`);
}

async function deleteChatFromList(page: Page, chatTitle: string) {
  const listItem = page.locator('[role="listitem"]').filter({ hasText: chatTitle });
  await listItem.hover();
  const deleteBtn = listItem.locator('.g-aikit-history__delete-button');
  await deleteBtn.click();

  const confirmBtn = page
    .getByRole('button', { name: /confirm|подтвердить|да|yes|delete|удалить/i })
    .first();
  const hasConfirm = await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false);
  if (hasConfirm) await confirmBtn.click();
}

test.describe('Удаление чата — влияние на активный чат', () => {
  let inactiveChatId: number;
  let activeChatId: number;
  const inactiveChatTitle = `del-inactive-${crypto.randomUUID().slice(0, 8)}`;
  const activeChatTitle = `del-active-${crypto.randomUUID().slice(0, 8)}`;

  test.beforeEach(async () => {
    inactiveChatId = await createChatViaApi(inactiveChatTitle);
    activeChatId = await createChatViaApi(activeChatTitle);
  });

  test.afterEach(async () => {
    await deleteChatViaApi(inactiveChatId).catch(() => {});
    await deleteChatViaApi(activeChatId).catch(() => {});
  });

  test('Удаление неактивного чата не затрагивает активный', async ({ page }) => {
    await navigateToHistoryKeepingActive(page, activeChatId);

    await expect(page.getByText(inactiveChatTitle)).toBeVisible();
    await expect(page.getByText(activeChatTitle)).toBeVisible();

    await deleteChatFromList(page, inactiveChatTitle);

    await expect(page.getByText(inactiveChatTitle)).not.toBeVisible();
    await expect(page.getByText(activeChatTitle)).toBeVisible();
  });

  test('Удаление активного чата убирает его из списка и не оставляет следов в новом чате', async ({ page }) => {
    await navigateToHistoryKeepingActive(page, activeChatId);

    await expect(page.getByText(activeChatTitle)).toBeVisible();
    await deleteChatFromList(page, activeChatTitle);
    await expect(page.getByText(activeChatTitle)).not.toBeVisible();

    await page.locator('.app-nav-desktop').getByText('Новый чат').click();
    await expect(page).toHaveURL(`${BASE_URL}/`);
    await expect(page.getByText('Чем могу помочь?')).toBeVisible();
    await expect(page.getByText(activeChatTitle)).not.toBeVisible();
  });
});
