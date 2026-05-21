import { XMLParser } from 'fast-xml-parser';
import type { Source } from '../../../shared/types.js';

export type { Source };

const ENDPOINT = 'https://searchapi.api.cloud.yandex.net/v2/web/search';
const QUERY_MAX_LEN = 400;
const SNIPPET_MAX_LEN = 400;
const TIMEOUT_MS = 5_000;

const parser = new XMLParser({
  ignoreAttributes: true,
  isArray: (name) => ['doc', 'passage', 'group'].includes(name),
});

function asText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(asText).join(' ');
  if (typeof v === 'object' && '#text' in (v as Record<string, unknown>)) {
    return asText((v as Record<string, unknown>)['#text']);
  }
  return '';
}

export async function webSearch(
  query: string,
  signal?: AbortSignal,
): Promise<Source[]> {
  const apiKey = process.env.YC_SEARCH_API_KEY;
  const folderId = process.env.YC_FOLDER_ID;
  if (!apiKey) {
    console.error('[search] YC_SEARCH_API_KEY is not set');
    return [];
  }
  if (!folderId) {
    console.error('[search] YC_FOLDER_ID is not set');
    return [];
  }

  const queryText = query.slice(0, QUERY_MAX_LEN);
  const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
  const mergedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  const body = {
    query: {
      searchType: 'SEARCH_TYPE_RU',
      queryText,
      familyMode: 'FAMILY_MODE_MODERATE',
      fixTypoMode: 'FIX_TYPO_MODE_ON',
    },
    groupSpec: {
      groupMode: 'GROUP_MODE_FLAT',
      groupsOnPage: 5,
      docsInGroup: 1,
    },
    maxPassages: 3,
    l10n: 'LOCALIZATION_RU',
    folderId,
    responseFormat: 'FORMAT_XML',
  };

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Api-Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: mergedSignal,
    });
  } catch (err) {
    console.error('[search] fetch failed:', err);
    return [];
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error(`[search] HTTP ${response.status}: ${text.slice(0, 500)}`);
    return [];
  }

  let json: { rawData?: string };
  try {
    json = (await response.json()) as { rawData?: string };
  } catch (err) {
    console.error('[search] response JSON parse failed:', err);
    return [];
  }

  if (!json.rawData) {
    console.error('[search] response has no rawData');
    return [];
  }

  const xml = Buffer.from(json.rawData, 'base64').toString('utf-8');

  // fast-xml-parser ломает inline-микс текста и тега `<hlword>` внутри <title>/<passage>
  // (выносит hlword отдельным узлом, теряя порядок и текст вокруг), поэтому срезаем
  // подсветку прямо в XML — до парсинга.
  const cleanedXml = xml.replace(/<\/?hlword>/g, '');

  let parsed: any;
  try {
    parsed = parser.parse(cleanedXml);
  } catch (err) {
    console.error('[search] XML parse failed:', err);
    return [];
  }

  const errorNode = parsed?.yandexsearch?.response?.error;
  if (errorNode) {
    console.error('[search] API error:', asText(errorNode));
    return [];
  }

  const groups = parsed?.yandexsearch?.response?.results?.grouping?.group ?? [];
  const sources: Source[] = [];
  let position = 1;
  for (const group of groups) {
    const docs = group?.doc ?? [];
    for (const doc of docs) {
      const title = asText(doc?.title).trim();
      const url = asText(doc?.url).trim();
      const passages = doc?.passages?.passage ?? [];
      const snippet = passages
        .map(asText)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, SNIPPET_MAX_LEN);
      if (!url || !title) continue;
      sources.push({ position: position++, title, url, snippet });
      if (sources.length >= 5) return sources;
    }
  }
  return sources;
}
