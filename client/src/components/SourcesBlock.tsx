import { Card, Text } from '@gravity-ui/uikit';
import type { Source } from '../types';
import './SourcesBlock.css';

interface Props {
  messageId: string;
  sources: Source[];
}

export function SourcesBlock({ messageId, sources }: Props) {
  if (sources.length === 0) return null;

  return (
    <div className="sources-block">
      <Text variant="subheader-2" className="sources-block__title">
        Источники
      </Text>
      <div className="sources-block__list">
        {sources.map((s) => {
          let host = '';
          try {
            host = new URL(s.url).hostname;
          } catch {
            host = s.url;
          }

          return (
            <Card key={s.position} className="sources-block__card" type="container">
              <a id={`src-${messageId}-${s.position}`} className="sources-block__anchor" />
              <div className="sources-block__card-inner">
                <div className="sources-block__meta">
                  <img
                    className="sources-block__favicon"
                    src={`https://www.google.com/s2/favicons?domain=${host}`}
                    alt=""
                    width={14}
                    height={14}
                  />
                  <Text variant="caption-1" color="secondary">
                    {host}
                  </Text>
                </div>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sources-block__link"
                >
                  <Text variant="body-2">{s.title}</Text>
                </a>
                {s.snippet && (
                  <Text variant="caption-1" color="secondary" className="sources-block__snippet">
                    {s.snippet}
                  </Text>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
