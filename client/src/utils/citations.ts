import type { Source } from '../types';

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Extracts all valid [N] refs from each line, removes them, and appends a single
// citation pill at the end of the line. Mirrors Perplexity's UX where pills sit
// at the end of a paragraph instead of inline.
export function injectCitationLinks(text: string, messageId: string, sources: Source[]): string {
  const maxN = sources.length;

  return text
    .split('\n')
    .map((line) => {
      const refs: number[] = [];

      const cleaned = line.replace(/\s*(?:\[\d+\])+/g, (match) => {
        const nums = [...match.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
        const valid = nums.filter((n) => n >= 1 && n <= maxN);
        if (valid.length === 0) return match;
        refs.push(...valid);
        return '';
      });

      if (refs.length === 0) return line;

      const first = refs[0];
      const domain = hostOf(sources[first - 1].url);
      const label = refs.length > 1 ? `${domain} +${refs.length - 1}` : domain;
      const pill = `[${label}](#src-${messageId}-${first})`;

      return `${cleaned} ${pill}`;
    })
    .join('\n');
}
