/**
 * Renders HTML content (e.g. product description)
 */

import React from 'react';

type HtmlContentProps = {
  html?: string;
  className?: string;
  [k: string]: unknown;
};

export function HtmlContent(props: HtmlContentProps) {
  const { html, className, ...rest } = props;
  if (!html) return null;
  return (
    <div
      className={className as string}
      dangerouslySetInnerHTML={{ __html: html }}
      {...(rest as React.HTMLAttributes<HTMLDivElement>)}
    />
  );
}
