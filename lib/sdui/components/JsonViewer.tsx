'use client';

import React from 'react';

interface JsonViewerProps {
  data?: unknown;
  indent?: number;
  className?: string;
  style?: React.CSSProperties;
  'data-builder-id'?: string;
  'data-builder-depth'?: string;
}

function colorize(raw: string): React.ReactNode {
  const lines = raw.split('\n');
  return lines.map((line, i) => {
    const keyMatch = line.match(/^(\s*)(".*?")(\s*:\s*)(.*)/);
    if (keyMatch) {
      const [, indent, key, colon, value] = keyMatch;
      let valueNode: React.ReactNode = value;
      if (value.startsWith('"')) valueNode = <span className="text-green-600 dark:text-green-400">{value}</span>;
      else if (value === 'true' || value === 'false') valueNode = <span className="text-blue-600 dark:text-blue-400">{value}</span>;
      else if (value === 'null') valueNode = <span className="text-gray-400">{value}</span>;
      else if (!isNaN(Number(value.replace(/,$/, '')))) valueNode = <span className="text-amber-600 dark:text-amber-400">{value}</span>;
      return (
        <div key={i}>
          {indent}
          <span className="text-purple-600 dark:text-purple-400">{key}</span>
          {colon}
          {valueNode}
        </div>
      );
    }
    return <div key={i}>{line}</div>;
  });
}

const JsonViewer = React.forwardRef<HTMLDivElement, JsonViewerProps>(
  ({ data, indent = 2, className = '', style, ...rest }, ref) => {
    const raw = data != null ? JSON.stringify(data, null, indent) : '// No data';

    return (
      <div ref={ref} style={style} className={`overflow-auto ${className}`} {...rest}>
        <pre className="text-xs font-mono bg-gray-50 dark:bg-gray-900 p-3 rounded-lg border border-gray-200 dark:border-gray-700 leading-relaxed">
          {colorize(raw)}
        </pre>
      </div>
    );
  },
);

JsonViewer.displayName = 'JsonViewer';
export default JsonViewer;
