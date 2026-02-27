'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';

interface MarkdownViewerProps {
  content?: string;
  className?: string;
  style?: React.CSSProperties;
  'data-builder-id'?: string;
  'data-builder-depth'?: string;
}

const PLACEHOLDER = `## Markdown Viewer

Write **bold**, *italic*, or \`inline code\`.

- List item 1
- List item 2
- List item 3

> A blockquote example

Set the \`content\` prop to display your markdown.`;

const MarkdownViewer = React.forwardRef<HTMLDivElement, MarkdownViewerProps>(
  ({ content, className = '', style, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        style={style}
        className={`prose prose-sm dark:prose-invert max-w-none ${className}`}
        {...rest}
      >
        <ReactMarkdown>{content ?? PLACEHOLDER}</ReactMarkdown>
      </div>
    );
  },
);

MarkdownViewer.displayName = 'MarkdownViewer';
export default MarkdownViewer;
