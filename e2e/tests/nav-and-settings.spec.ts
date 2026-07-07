import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3001';
const TOKEN = 'kakako';

async function loginAndNavigate(page: Page, url = BASE_URL) {
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
    await page.goto(BASE_URL).catch(() => {});
    await page.waitForTimeout(500);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Nav rail (desktop)', () => {
  test('Shows Dexity title and three nav items on root page', async ({ page }) => {
    await loginAndNavigate(page);

    // Desktop nav wrapper is visible
    const desktopNav = page.locator('.app-nav-desktop');
    await expect(desktopNav).toBeVisible();

    // Title
    await expect(desktopNav.getByText('Dexity')).toBeVisible();

    // Three nav items
    await expect(desktopNav.getByText('Новый чат')).toBeVisible();
    await expect(desktopNav.getByText('История')).toBeVisible();
    await expect(desktopNav.getByText('Настройки')).toBeVisible();
  });

  test('Clicking "История" navigates to /history and shows history page', async ({ page }) => {
    await loginAndNavigate(page);

    const desktopNav = page.locator('.app-nav-desktop');
    await desktopNav.getByText('История').click();

    await expect(page).toHaveURL(`${BASE_URL}/history`);
    // Text variant="header-1" renders as a styled span, not a semantic heading
    await expect(page.getByText('История', { exact: true }).first()).toBeVisible();
  });

  test('Clicking "Настройки" navigates to /settings and shows settings page', async ({ page }) => {
    await loginAndNavigate(page);

    const desktopNav = page.locator('.app-nav-desktop');
    await desktopNav.getByText('Настройки').click();

    await expect(page).toHaveURL(`${BASE_URL}/settings`);
    // Text variant="header-1" renders as a styled span, not a semantic heading
    await expect(page.getByText('Настройки', { exact: true }).first()).toBeVisible();
  });

  test('Clicking "Новый чат" navigates to / and shows empty state', async ({ page }) => {
    // Start on /history, then click "Новый чат"
    await loginAndNavigate(page, `${BASE_URL}/history`);

    const desktopNav = page.locator('.app-nav-desktop');
    await desktopNav.getByText('Новый чат').click();

    await expect(page).toHaveURL(BASE_URL + '/');
    // EmptyContainer shows "Чем могу помочь?"
    await expect(page.getByText('Чем могу помочь?')).toBeVisible();
  });

  test('Active nav item has app-nav-item--active class', async ({ page }) => {
    await loginAndNavigate(page, `${BASE_URL}/history`);

    // The /history link should be active
    const historyLink = page.locator('.app-nav-desktop .app-nav-item--active');
    await expect(historyLink).toBeVisible();
    await expect(historyLink).toHaveText(/История/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe('History page (/history)', () => {
  let chat1Id: number;
  let chat2Id: number;
  const chat1Title = `nav-hist-a-${crypto.randomUUID().slice(0, 8)}`;
  const chat2Title = `nav-hist-b-${crypto.randomUUID().slice(0, 8)}`;

  test.beforeAll(async () => {
    chat1Id = await createChatViaApi(chat1Title);
    chat2Id = await createChatViaApi(chat2Title);
  });

  test.afterAll(async () => {
    await deleteChatViaApi(chat1Id).catch(() => {});
    await deleteChatViaApi(chat2Id).catch(() => {});
  });

  // NOTE: HistoryPage reads from chatStore but does NOT call fetchChats() itself.
  // fetchChats() is only triggered by ChatPage's useEffect on mount.
  // To see chats on /history we must use client-side navigation (NavLink click)
  // so the React app stays mounted and the store state persists. A full page.goto()
  // would reset the in-memory Zustand store.
  async function loginAndNavigateToHistory(page: Page) {
    await loginAndNavigate(page, BASE_URL);
    // Wait for fetchChats to complete
    await page.waitForLoadState('networkidle');
    // Use nav link click to preserve store state (no full page reload)
    await page.locator('.app-nav-desktop').getByText('История').click();
    await page.waitForURL(`${BASE_URL}/history`);
  }

  test('Displays chat list with created chats', async ({ page }) => {
    await loginAndNavigateToHistory(page);

    await expect(page.getByText(chat1Title)).toBeVisible();
    await expect(page.getByText(chat2Title)).toBeVisible();
  });

  test('Search filters the chat list by title', async ({ page }) => {
    await loginAndNavigateToHistory(page);

    // Both chats visible initially
    await expect(page.getByText(chat1Title)).toBeVisible();
    await expect(page.getByText(chat2Title)).toBeVisible();

    // Type the unique suffix of chat1 into the search input
    const uniqueSuffix = chat1Title.split('-').pop()!;
    // HistoryList renders its search with placeholder "Search your chats"
    const searchInput = page.getByPlaceholder('Search your chats');
    await searchInput.fill(uniqueSuffix);

    // chat1 should remain, chat2 (different suffix) should disappear
    await expect(page.getByText(chat1Title)).toBeVisible();
    await expect(page.getByText(chat2Title)).not.toBeVisible({ timeout: 2000 });
  });

  test('Clicking a chat navigates to /chat/:id', async ({ page }) => {
    await loginAndNavigateToHistory(page);

    // Find the list item for chat1 and click it
    const listItem = page.locator('[role="listitem"]').filter({ hasText: chat1Title });
    await listItem.click();

    await expect(page).toHaveURL(`${BASE_URL}/chat/${chat1Id}`);
  });

  test('Deleting a chat via HistoryList removes it from the list', async ({ page }) => {
    const toDeleteTitle = `nav-del-${crypto.randomUUID().slice(0, 8)}`;
    const toDeleteId = await createChatViaApi(toDeleteTitle);

    try {
      await loginAndNavigateToHistory(page);

      const listItem = page.locator('[role="listitem"]').filter({ hasText: toDeleteTitle });
      await expect(listItem).toBeVisible();

      await listItem.hover();
      const deleteBtn = listItem.locator('.g-aikit-history__delete-button');
      await expect(deleteBtn).toBeVisible();
      await deleteBtn.click();

      // Handle optional confirm dialog
      const confirmBtn = page
        .getByRole('button', { name: /confirm|подтвердить|да|yes|delete|удалить/i })
        .first();
      const hasConfirm = await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false);
      if (hasConfirm) {
        await confirmBtn.click();
      }

      await expect(page.getByText(toDeleteTitle)).not.toBeVisible({ timeout: 3000 });
    } finally {
      await deleteChatViaApi(toDeleteId).catch(() => {});
    }
  });

  test('"+ Новый чат" button creates a chat and redirects to it', async ({ page }) => {
    await loginAndNavigate(page, `${BASE_URL}/history`);

    await page.getByRole('button', { name: /новый чат/i }).click();

    // Should redirect to /chat/:id (some new chat)
    await page.waitForURL(/\/chat\/\d+/, { timeout: 5000 });
    await expect(page).toHaveURL(/\/chat\/\d+/);

    // Clean up the created chat
    const url = page.url();
    const match = url.match(/\/chat\/(\d+)/);
    if (match) {
      await deleteChatViaApi(parseInt(match[1], 10)).catch(() => {});
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Settings page (/settings)', () => {
  test.beforeEach(async ({ page }) => {
    // Clean any lingering systemPrompt before each test
    await page.goto(`${BASE_URL}/login`);
    await page.evaluate((token) => {
      localStorage.setItem('auth-token', JSON.stringify({ state: { token }, version: 0 }));
      // Clear systemPrompt in dexity-settings
      const raw = localStorage.getItem('dexity-settings');
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.state) parsed.state.systemPrompt = '';
          localStorage.setItem('dexity-settings', JSON.stringify(parsed));
        } catch {
          // ignore
        }
      }
    }, TOKEN);
  });

  test('Shows "Настройки" heading and TextArea for system prompt', async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState('networkidle');

    // Text variant="header-1" renders as a styled span, not a semantic heading
    await expect(page.getByText('Настройки', { exact: true }).first()).toBeVisible();
    // TextArea is rendered as a textarea element
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
  });

  test('Typing text saves to localStorage dexity-settings after debounce', async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState('networkidle');

    const textarea = page.locator('textarea');
    await textarea.fill('Тест системного промпта');

    // Wait for debounce (500ms) + margin
    await page.waitForTimeout(800);

    const stored = await page.evaluate(() => localStorage.getItem('dexity-settings'));
    expect(stored).not.toBeNull();

    const parsed = JSON.parse(stored!);
    expect(parsed?.state?.systemPrompt).toBe('Тест системного промпта');
  });

  test('Shows "Сохранено" indicator after typing, which disappears after ~1.5s', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState('networkidle');

    const textarea = page.locator('textarea');
    await textarea.fill('Промпт для индикатора');

    // Wait for debounce to fire (500ms), then the indicator should appear
    await expect(page.getByText('Сохранено')).toBeVisible({ timeout: 2000 });

    // After ~1.5 more seconds it should disappear
    await expect(page.getByText('Сохранено')).not.toBeVisible({ timeout: 3000 });
  });

  test('Text persists in TextArea after page reload', async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState('networkidle');

    const textarea = page.locator('textarea');
    await textarea.fill('Сохраняемый промпт');

    // Wait for save
    await page.waitForTimeout(800);

    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('textarea')).toHaveValue('Сохраняемый промпт');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Regression: systemPrompt sent in POST /messages/stream body', () => {
  test('systemPrompt is included in stream request body', async ({ page }) => {
    const testPrompt = 'Отвечай только числами';

    // Set up auth and clear/set systemPrompt
    await page.goto(`${BASE_URL}/login`);
    await page.evaluate(
      ({ token, prompt }) => {
        localStorage.setItem('auth-token', JSON.stringify({ state: { token }, version: 0 }));
        const raw = localStorage.getItem('dexity-settings');
        let parsed: Record<string, unknown> = { state: {}, version: 0 };
        if (raw) {
          try {
            parsed = JSON.parse(raw);
          } catch {
            // ignore
          }
        }
        if (!parsed.state || typeof parsed.state !== 'object') parsed.state = {};
        (parsed.state as Record<string, unknown>).systemPrompt = prompt;
        localStorage.setItem('dexity-settings', JSON.stringify(parsed));
      },
      { token: TOKEN, prompt: testPrompt },
    );

    // Navigate to /settings to confirm textarea shows the prompt
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('textarea')).toHaveValue(testPrompt);

    // Navigate to home (new chat)
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Intercept the stream POST request
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

    // Send a message via PromptInput
    const textarea = page.getByRole('textbox');
    await textarea.fill('привет');
    await textarea.press('Enter');

    // Wait for the request to be captured
    await page.waitForTimeout(2000);

    expect(capturedBody, 'Stream request should have been captured').not.toBeNull();
    expect(
      capturedBody!['systemPrompt'],
      `"systemPrompt" should be present and correct in POST body, got: ${JSON.stringify(capturedBody)}`,
    ).toBe(testPrompt);

    // Cleanup: clear the systemPrompt and cancel stream if active
    await page.evaluate(() => {
      const raw = localStorage.getItem('dexity-settings');
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.state) parsed.state.systemPrompt = '';
          localStorage.setItem('dexity-settings', JSON.stringify(parsed));
        } catch {
          // ignore
        }
      }
    });
    await cancelStreamIfActive(page);

    // Clean up the chat that was created
    const url = page.url();
    const match = url.match(/\/chat\/(\d+)/);
    if (match) {
      await deleteChatViaApi(parseInt(match[1], 10)).catch(() => {});
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Mobile navigation (375x667)', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('Desktop nav is hidden and hamburger button is visible at 375px', async ({ page }) => {
    await loginAndNavigate(page);

    // Desktop nav should be hidden (CSS display: none at ≤640px)
    const desktopNav = page.locator('.app-nav-desktop');
    await expect(desktopNav).not.toBeVisible();

    // Mobile header with hamburger button should be visible
    const mobileHeader = page.locator('.app-mobile-header');
    await expect(mobileHeader).toBeVisible();

    // The hamburger button (Bars icon, rendered inside a <button>)
    const hamburger = mobileHeader.locator('button').first();
    await expect(hamburger).toBeVisible();
  });

  test('Clicking hamburger opens the mobile nav rail', async ({ page }) => {
    await loginAndNavigate(page);

    const hamburger = page.locator('.app-mobile-header button').first();
    await hamburger.click();

    // Mobile nav should have --open class and translateX(0)
    const mobileNav = page.locator('.app-nav-mobile');
    await expect(mobileNav).toHaveClass(/app-nav-mobile--open/);

    // Overlay should be visible
    const overlay = page.locator('.app-nav-overlay');
    await expect(overlay).toBeVisible();
  });

  test('Clicking overlay closes the mobile nav', async ({ page }) => {
    await loginAndNavigate(page);

    // Open
    const hamburger = page.locator('.app-mobile-header button').first();
    await hamburger.click();

    const overlay = page.locator('.app-nav-overlay');
    await expect(overlay).toBeVisible();

    // Close by clicking overlay
    await overlay.click();

    await expect(page.locator('.app-nav-overlay')).not.toBeVisible({ timeout: 2000 });
    await expect(page.locator('.app-nav-mobile')).not.toHaveClass(/app-nav-mobile--open/);
  });

  test('Clicking a nav item navigates and closes the mobile menu', async ({ page }) => {
    await loginAndNavigate(page);

    // Open menu
    const hamburger = page.locator('.app-mobile-header button').first();
    await hamburger.click();

    const mobileNav = page.locator('.app-nav-mobile');
    await expect(mobileNav).toHaveClass(/app-nav-mobile--open/);

    // Click "История"
    await mobileNav.getByText('История').click();

    // URL changed
    await expect(page).toHaveURL(`${BASE_URL}/history`);

    // Menu should be closed
    await expect(page.locator('.app-nav-mobile')).not.toHaveClass(/app-nav-mobile--open/);
    await expect(page.locator('.app-nav-overlay')).not.toBeVisible({ timeout: 2000 });
  });
});
