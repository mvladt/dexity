import { isIP } from 'node:net';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export interface FetchResult {
  url: string;
  title: string;
  content: string;
}

export const webFetchTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'web_fetch',
    description:
      'Читает и извлекает основной текст веб-страницы по URL. Сниппеты из web_search короткие — чтобы ответить точно и подробно, открывай страницы и читай полный текст. Не ограничивайся одной ссылкой: для развёрнутого ответа открывай несколько релевантных источников (можно сразу несколько за один раз — вызовы выполняются параллельно). Используй для ссылок от пользователя и для углубления в результаты web_search.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Полный URL страницы (http/https)' },
      },
      required: ['url'],
    },
  },
};

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 5;
const CONTENT_MAX = 15_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; Dexity/1.0)';

// ─── SSRF-защита ────────────────────────────────────────────────────────────

/** Парсит IPv4-строку в 32-битный unsigned int. Возвращает -1 при ошибке. */
function parseIPv4(addr: string): number {
  const parts = addr.split('.');
  if (parts.length !== 4) return -1;
  let n = 0;
  for (const p of parts) {
    const b = Number(p);
    if (!Number.isInteger(b) || b < 0 || b > 255) return -1;
    n = (n << 8) | b;
  }
  return n >>> 0;
}

/** Проверяет попадание IPv4-адреса в блокируемые диапазоны. */
function isBlockedIPv4(addr: string): boolean {
  const ip = parseIPv4(addr);
  if (ip === -1) return true; // не распарсилось — блокируем

  const ranges: [number, number][] = [
    [0x00000000, 0xff000000], // 0.0.0.0/8
    [0x0a000000, 0xff000000], // 10.0.0.0/8
    [0x7f000000, 0xff000000], // 127.0.0.0/8
    [0xa9fe0000, 0xffff0000], // 169.254.0.0/16
    [0xac100000, 0xfff00000], // 172.16.0.0/12
    [0xc0a80000, 0xffff0000], // 192.168.0.0/16
  ];

  for (const [network, mask] of ranges) {
    // `>>> 0` — приводим результат `&` к unsigned: для диапазонов со старшим
    // битом ≥ 0x80 (192.168/16, 172.16/12, 169.254/16) знаковый int дал бы
    // отрицательное число и сравнение с положительным network'ом провалилось бы.
    if (((ip & mask) >>> 0) === network) return true;
  }
  return false;
}

/**
 * Парсит IPv6-адрес в массив из 16 байт.
 * Поддерживает сжатие `::` и IPv4-mapped суффикс `::ffff:a.b.c.d`.
 * Возвращает null при ошибке.
 */
function parseIPv6(addr: string): Uint8Array | null {
  // Убираем обрамляющие скобки (если вдруг остались)
  addr = addr.replace(/^\[|\]$/g, '');

  const halves = addr.split('::');
  if (halves.length > 2) return null;

  const expandGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups = part.split(':');
    const result: number[] = [];
    for (const g of groups) {
      // Последний «группа» может быть IPv4-адресом
      if (g.includes('.')) {
        const v4 = parseIPv4(g);
        if (v4 === -1) return null;
        result.push((v4 >>> 24) & 0xff, (v4 >>> 16) & 0xff, (v4 >>> 8) & 0xff, v4 & 0xff);
      } else {
        const n = parseInt(g, 16);
        if (isNaN(n) || n < 0 || n > 0xffff) return null;
        result.push((n >> 8) & 0xff, n & 0xff);
      }
    }
    return result;
  };

  let left: number[];
  let right: number[];

  if (halves.length === 1) {
    const g = expandGroups(halves[0]);
    if (!g || g.length !== 16) return null;
    return new Uint8Array(g);
  } else {
    const l = expandGroups(halves[0]);
    const r = expandGroups(halves[1]);
    if (!l || !r) return null;
    const missing = 16 - l.length - r.length;
    if (missing < 0) return null;
    left = l;
    right = r;
    const bytes = [...left, ...Array(missing).fill(0), ...right];
    if (bytes.length !== 16) return null;
    return new Uint8Array(bytes);
  }
}

/** Проверяет попадание IPv6-адреса в блокируемые диапазоны. */
function isBlockedIPv6(addr: string): boolean {
  const b = parseIPv6(addr);
  if (!b) return true; // не распарсилось — блокируем (fail-safe)

  // ::1 — loopback
  if (b.every((x, i) => (i === 15 ? x === 1 : x === 0))) return true;
  // :: — unspecified
  if (b.every((x) => x === 0)) return true;
  // fc00::/7 — unique local (ULA)
  if ((b[0] & 0xfe) === 0xfc) return true;
  // fe80::/10 — link-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;
  // ::ffff:0:0/96 — IPv4-mapped: байты 0-9 = 0, 10-11 = 0xff, 12-15 = IPv4
  const isIPv4Mapped =
    b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff;
  if (isIPv4Mapped) {
    const ipv4 = `${b[12]}.${b[13]}.${b[14]}.${b[15]}`;
    return isBlockedIPv4(ipv4);
  }

  return false;
}

/** Возвращает true, если хост следует заблокировать. */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (h === 'localhost' || h.endsWith('.localhost')) return true;

  const ipVersion = isIP(h);
  if (ipVersion === 4) return isBlockedIPv4(h);
  if (ipVersion === 6) return isBlockedIPv6(h);

  // Домен — не блокируем (DNS-rebinding осознанно вне скоупа, TODO: добавить
  // post-resolution проверку через dns.promises.lookup при необходимости).
  return false;
}

/** Валидирует URL и бросает ошибку, если хост в блок-листе. */
function assertUrlAllowed(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Некорректный URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Недопустимый протокол: ${u.protocol}`);
  }
  if (isBlockedHost(u.hostname)) {
    throw new Error(`Доступ к хосту запрещён: ${u.hostname}`);
  }
  return u;
}

// ─── Основная функция ────────────────────────────────────────────────────────

/**
 * Загружает страницу по URL и возвращает извлечённый читаемый текст.
 * Поддерживает SSRF-защиту, ограничение размера, ручные редиректы.
 */
export async function fetchUrl(url: string, signal?: AbortSignal): Promise<FetchResult> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const merged = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let currentUrl = assertUrlAllowed(url).toString();
  let response!: Response;

  for (let redirects = 0; ; redirects++) {
    if (redirects > MAX_REDIRECTS) {
      throw new Error('Слишком много редиректов');
    }

    response = await fetch(currentUrl, {
      redirect: 'manual',
      signal: merged,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) break; // нет location — выходим с тем что есть

      // Отменяем тело текущего ответа, чтобы не держать соединение
      await response.body?.cancel().catch(() => {});

      const next = new URL(location, currentUrl).toString();
      assertUrlAllowed(next); // SSRF-проверка на каждом хопе
      currentUrl = next;
      continue;
    }

    break;
  }

  // Проверка Content-Type
  const ct = response.headers.get('content-type');
  if (!ct) throw new Error('Ответ без Content-Type');
  if (!ct.includes('text/html') && !ct.includes('application/xhtml+xml')) {
    throw new Error(`Неподдерживаемый тип контента: ${ct}`);
  }

  // Ранний отсев по Content-Length
  const clHeader = response.headers.get('content-length');
  if (clHeader !== null) {
    const cl = Number(clHeader);
    if (!isNaN(cl) && cl > MAX_BYTES) throw new Error('Страница слишком большая');
  }

  // Потоковое чтение с ограничением размера
  if (!response.body) throw new Error('Ответ без тела');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BYTES) {
      await reader.cancel();
      throw new Error('Страница слишком большая');
    }
    chunks.push(value);
  }

  const html = Buffer.concat(chunks).toString('utf-8');

  // Парсинг и извлечение читаемого контента
  const { document } = parseHTML(html);
  const article = new Readability(document as any).parse();

  if (!article || !article.textContent?.trim()) {
    throw new Error('Не удалось извлечь читаемый контент со страницы');
  }

  // Нормализация: убираем тройные+ переводы строк
  let content = article.textContent.trim().replace(/\n{3,}/g, '\n\n');
  if (content.length > CONTENT_MAX) {
    content = content.slice(0, CONTENT_MAX) + '\n…[обрезано]';
  }

  return {
    url: currentUrl,
    title: (article.title ?? '').trim(),
    content,
  };
}
