export function injectCitationLinks(text: string, messageId: string, maxN: number): string {
  return text.replace(/\[(\d+)\]/g, (m, n) =>
    Number(n) >= 1 && Number(n) <= maxN ? `[\\[${n}\\]](#src-${messageId}-${n})` : m,
  );
}
