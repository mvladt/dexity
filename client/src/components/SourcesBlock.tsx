import { Text } from '@gravity-ui/uikit';
import type { Source } from '../types';
import './SourcesBlock.css';

interface Props {
  messageId: string;
  sources: Source[];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function SourcesBlock({ messageId, sources }: Props) {
  if (sources.length === 0) return null;

  return (
    <ul className="sources-block">
      {sources.map((s) => {
        const host = hostOf(s.url);
        return (
          <li key={s.position} className="sources-block__item">
            <a id={`src-${messageId}-${s.position}`} className="sources-block__anchor" />
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="sources-block__link"
              title={s.title}
            >
              <span className="sources-block__meta">
                <img
                  className="sources-block__favicon"
                  src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
                  alt=""
                  width={14}
                  height={14}
                />
                <Text variant="caption-1" color="secondary" className="sources-block__host">
                  {host}
                </Text>
                <Text variant="caption-1" color="hint" className="sources-block__index">
                  {s.position}
                </Text>
              </span>
              <Text variant="caption-2" className="sources-block__title">
                {s.title}
              </Text>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
