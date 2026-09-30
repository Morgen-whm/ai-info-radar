import type { ReactNode } from "react";

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function renderInline(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\[([^\]]+)]\((https?:\/\/[^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let cursor = 0;
  let part = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(value.slice(cursor, index));
    const link = match[2] ? safeExternalUrl(match[2]) : null;
    if (match[1] && link) {
      nodes.push(
        <a
          key={`${keyPrefix}-link-${part}`}
          href={link}
          target="_blank"
          rel="noreferrer noopener"
        >
          {match[1]}
        </a>,
      );
    } else if (match[3]) {
      nodes.push(<strong key={`${keyPrefix}-strong-${part}`}>{match[3]}</strong>);
    } else if (match[4]) {
      nodes.push(<code key={`${keyPrefix}-code-${part}`}>{match[4]}</code>);
    } else {
      nodes.push(match[0]);
    }
    cursor = index + match[0].length;
    part += 1;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

export function MarkdownArticle({ markdown }: { markdown: string }) {
  const blocks: ReactNode[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const raw = lines[index];
    const line = raw.trim();
    if (!line) {
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre key={`code-${index}`} data-language={language || undefined}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const image = line.match(/^!\[([^\]]*)]\((https?:\/\/[^)\s]+)\)$/);
    const imageUrl = image?.[2] ? safeExternalUrl(image[2]) : null;
    if (image && imageUrl) {
      blocks.push(
        <figure key={`image-${index}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={image[1] || "文章来源配图"}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
          {image[1] ? <figcaption>{image[1]}</figcaption> : null}
        </figure>,
      );
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const content = renderInline(heading[2], `heading-${index}`);
      blocks.push(
        heading[1].length === 1 ? (
          <h2 key={`heading-${index}`}>{content}</h2>
        ) : heading[1].length === 2 ? (
          <h3 key={`heading-${index}`}>{content}</h3>
        ) : (
          <h4 key={`heading-${index}`}>{content}</h4>
        ),
      );
      index += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(
          <li key={`bullet-${index}`}>
            {renderInline(
              lines[index].trim().replace(/^[-*]\s+/, ""),
              `bullet-${index}`,
            )}
          </li>,
        );
        index += 1;
      }
      blocks.push(<ul key={`list-${index}`}>{items}</ul>);
      continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index].trim())) {
        items.push(
          <li key={`ordered-${index}`}>
            {renderInline(
              lines[index].trim().replace(/^\d+[.)]\s+/, ""),
              `ordered-${index}`,
            )}
          </li>,
        );
        index += 1;
      }
      blocks.push(<ol key={`ordered-list-${index}`}>{items}</ol>);
      continue;
    }
    if (line.startsWith(">")) {
      const quotes: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quotes.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={`quote-${index}`}>
          {renderInline(quotes.join(" "), `quote-${index}`)}
        </blockquote>,
      );
      continue;
    }
    if (/^---+$/.test(line)) {
      blocks.push(<hr key={`rule-${index}`} />);
      index += 1;
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,3})\s+|^!\[[^\]]*]\(https?:\/\/|^[-*]\s+|^\d+[.)]\s+|^>|^```|^---+$/.test(
        lines[index].trim(),
      )
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${index}`}>
        {renderInline(paragraph.join(" "), `paragraph-${index}`)}
      </p>,
    );
  }

  return <div className="knowledge-prose">{blocks}</div>;
}
