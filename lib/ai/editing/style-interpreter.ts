/**
 * Style Interpreter — Tier 1 Edits (Zero AI, instant)
 *
 * Maps natural language style requests to Tailwind class mutations.
 * Handles ~70% of all user edit requests with no AI call.
 *
 * Patterns are matched with regex before any AI is involved.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StyleRule {
  operation: 'add-class' | 'remove-class' | 'replace-class' | 'set-text' | 'remove-node' | 'toggle-hidden';
  /** For add-class / replace-class */
  addClass?: string;
  /** For remove-class / replace-class — regex patterns to remove */
  removePattern?: string;
  /** For set-text */
  text?: string;
}

export interface InterpretedStyleIntent {
  isStyleEdit: true;
  rule: StyleRule;
  confidence: number;
}

export interface NotStyleEdit {
  isStyleEdit: false;
}

export type StyleInterpretResult = InterpretedStyleIntent | NotStyleEdit;

// ─── Color mapping ────────────────────────────────────────────────────────────

const COLOR_MAP: Record<string, string> = {
  red: '500',
  blue: '500',
  green: '500',
  yellow: '400',
  orange: '500',
  purple: '600',
  pink: '500',
  gray: '500',
  grey: '500',
  black: '900',
  white: '50',
  indigo: '600',
  teal: '500',
  cyan: '500',
  amber: '400',
  lime: '500',
  emerald: '500',
  violet: '600',
  fuchsia: '500',
  rose: '500',
  sky: '500',
  slate: '500',
  zinc: '500',
  stone: '500',
  neutral: '500',
};

function resolveColorClass(color: string, prefix: 'bg' | 'text' | 'border'): string {
  const normalized = color.toLowerCase().trim();
  const shade = COLOR_MAP[normalized];
  if (!shade) return `${prefix}-${normalized}-500`;
  if (normalized === 'black') return `${prefix}-gray-900`;
  if (normalized === 'white') return `${prefix}-gray-50`;
  return `${prefix}-${normalized}-${shade}`;
}

// ─── Padding/Margin scale ─────────────────────────────────────────────────────

const PADDING_SCALE = ['p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6', 'p-8', 'p-10', 'p-12', 'p-16'];
const MARGIN_SCALE = ['m-1', 'm-2', 'm-3', 'm-4', 'm-5', 'm-6', 'm-8', 'm-10', 'm-12'];

function bumpScale(scale: string[], currentClass: string | undefined, direction: 'up' | 'down'): string {
  if (!currentClass) {
    return direction === 'up' ? scale[2] : scale[1];
  }
  const idx = scale.indexOf(currentClass);
  if (idx === -1) return direction === 'up' ? scale[2] : scale[1];
  const newIdx = direction === 'up' ? Math.min(idx + 1, scale.length - 1) : Math.max(idx - 1, 0);
  return scale[newIdx];
}

// ─── Text size scale ──────────────────────────────────────────────────────────

const TEXT_SCALE = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl', 'text-3xl', 'text-4xl', 'text-5xl'];

// ─── Pattern matchers ─────────────────────────────────────────────────────────

const PATTERNS: Array<{
  regex: RegExp;
  resolve: (match: RegExpMatchArray) => StyleRule | null;
}> = [
  // Background colors: "make it blue", "blue background", "background color red"
  {
    regex: /(?:make\s+it\s+)?(?:background\s+(?:color\s+)?)?(\w+)\s+(?:background|bg)|(?:background|bg)\s+(?:color\s+)?(\w+)|(make\s+it|change\s+to)\s+(\w+)(?:\s+background)?/i,
    resolve: (match) => {
      const color = (match[1] || match[2] || match[4])?.toLowerCase();
      if (!color || !COLOR_MAP[color] && color !== 'black' && color !== 'white') return null;
      return {
        operation: 'replace-class',
        addClass: `!${resolveColorClass(color, 'bg')}`,
        removePattern: '!?bg-\\S+',
      };
    },
  },
  // Text colors: "red text", "text color blue", "make text green"
  {
    regex: /(?:text\s+(?:color\s+)?|make\s+(?:the\s+)?text\s+|color\s+(?:the\s+)?text\s+)?(\w+)\s+(?:text|colored)|(?:text|font)\s+(?:color\s+)?(\w+)|(change\s+(?:the\s+)?)?text\s+(?:to\s+)?(\w+)/i,
    resolve: (match) => {
      const color = (match[1] || match[2] || match[4])?.toLowerCase();
      if (!color || !COLOR_MAP[color] && color !== 'black' && color !== 'white') return null;
      return {
        operation: 'replace-class',
        addClass: `!${resolveColorClass(color, 'text')}`,
        removePattern: '!?text-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d+',
      };
    },
  },
  // More/less padding
  {
    regex: /(?:more|add|increase|bigger|larger)\s+padding|padding\s+(?:up|more|bigger)/i,
    resolve: () => ({ operation: 'add-class', addClass: 'p-8', removePattern: '\\bp-\\d+\\b' }),
  },
  {
    regex: /(?:less|reduce|decrease|smaller)\s+padding|padding\s+(?:down|less|smaller)/i,
    resolve: () => ({ operation: 'replace-class', addClass: 'p-2', removePattern: '\\bp-\\d+\\b' }),
  },
  // Give it space / more space
  {
    regex: /(?:give\s+it|add|more)\s+(?:more\s+)?(?:space|spacing|room)|(?:spacious|roomy|breathe)/i,
    resolve: () => ({ operation: 'add-class', addClass: 'p-8 gap-8', removePattern: '\\bp-[0-9]+\\b|\\bgap-[0-9]+\\b' }),
  },
  // Remove / delete
  {
    regex: /(?:remove|delete|hide|get\s+rid\s+of)\s+(?:this|it|the)?/i,
    resolve: () => ({ operation: 'remove-node' }),
  },
  // Make bold
  {
    regex: /(?:make\s+(?:it\s+)?|add\s+)?bold|font-?weight\s*:\s*bold|font\s+bold/i,
    resolve: () => ({ operation: 'add-class', addClass: 'font-bold' }),
  },
  // Make italic
  {
    regex: /(?:make\s+(?:it\s+)?|add\s+)?italic/i,
    resolve: () => ({ operation: 'add-class', addClass: 'italic' }),
  },
  // Rounded corners
  {
    regex: /(?:add\s+)?(?:more\s+)?rounded|round\s+(?:the\s+)?corners?/i,
    resolve: () => ({ operation: 'add-class', addClass: 'rounded-xl', removePattern: '\\brounded(?:-\\w+)?\\b' }),
  },
  // Full rounded / pill
  {
    regex: /pill|full(?:y)?\s+round(?:ed)?/i,
    resolve: () => ({ operation: 'add-class', addClass: 'rounded-full', removePattern: '\\brounded(?:-\\w+)?\\b' }),
  },
  // Shadow
  {
    regex: /(?:add\s+)?(?:more\s+)?shadow|drop\s*-?\s*shadow/i,
    resolve: () => ({ operation: 'add-class', addClass: 'shadow-lg', removePattern: '\\bshadow(?:-\\w+)?\\b' }),
  },
  // Larger text
  {
    regex: /(?:make\s+(?:the\s+)?text\s+)?larger|bigger\s+(?:text|font)|(?:increase|bump\s+up)\s+(?:text\s+|font\s+)?size/i,
    resolve: () => ({ operation: 'add-class', addClass: 'text-xl', removePattern: '\\btext-(?:xs|sm|base|lg|xl|2xl|3xl)\\b' }),
  },
  // Smaller text
  {
    regex: /(?:make\s+(?:the\s+)?text\s+)?smaller|smaller\s+(?:text|font)|(?:decrease|reduce)\s+(?:text\s+|font\s+)?size/i,
    resolve: () => ({ operation: 'add-class', addClass: 'text-sm', removePattern: '\\btext-(?:xs|sm|base|lg|xl|2xl|3xl)\\b' }),
  },
  // Center text
  {
    regex: /(?:center|centre|align\s+to\s+center|text\s+align\s+center)/i,
    resolve: () => ({ operation: 'add-class', addClass: 'text-center', removePattern: '\\btext-(?:left|right)\\b' }),
  },
  // Left align
  {
    regex: /(?:left\s+align|align\s+(?:to\s+the\s+)?left|text\s+align\s+left)/i,
    resolve: () => ({ operation: 'add-class', addClass: 'text-left', removePattern: '\\btext-(?:center|right)\\b' }),
  },
  // Full width
  {
    regex: /(?:make\s+(?:it\s+)?)?full\s*-?\s*width/i,
    resolve: () => ({ operation: 'add-class', addClass: 'w-full' }),
  },
  // Hide element
  {
    regex: /(?:hide|invisible|not\s+visible|make\s+(?:it\s+)?invisible)/i,
    resolve: () => ({ operation: 'toggle-hidden' }),
  },
  // Border
  {
    regex: /(?:add\s+)?(?:a\s+)?border|outline/i,
    resolve: () => ({ operation: 'add-class', addClass: 'border border-gray-200 dark:border-gray-700' }),
  },
  // Remove border
  {
    regex: /remove\s+(?:the\s+)?border|no\s+border/i,
    resolve: () => ({ operation: 'remove-class', removePattern: '\\bborder(?:-\\w+)?\\b' }),
  },
  // Uppercase text
  {
    regex: /uppercase|all\s+caps?/i,
    resolve: () => ({ operation: 'add-class', addClass: 'uppercase tracking-wider' }),
  },
  // More margin / space between
  {
    regex: /(?:more|add|increase)\s+(?:margin|space\s+between|gap)/i,
    resolve: () => ({ operation: 'add-class', addClass: 'gap-8 my-6', removePattern: '\\bgap-[0-9]+\\b|\\bmy-[0-9]+\\b' }),
  },
];

// ─── Main interpreter ─────────────────────────────────────────────────────────

/**
 * Try to interpret a user request as a pure style edit (Tier 1).
 * Returns isStyleEdit: false if no pattern matches (should escalate to Tier 2).
 */
export function interpretStyleRequest(userText: string): StyleInterpretResult {
  const text = userText.trim().toLowerCase();

  // Check "change text to X" — content edit
  const changeTextMatch = text.match(/(?:change|set|update)\s+(?:the\s+)?text\s+to\s+["']?(.+?)["']?$/i);
  if (changeTextMatch) {
    return {
      isStyleEdit: true,
      rule: { operation: 'set-text', text: changeTextMatch[1].trim() },
      confidence: 0.95,
    };
  }

  // Remove / delete — always Tier 1
  if (/^(?:remove|delete|get\s+rid\s+of)\s*(this|it|the\s+\w+)?$/i.test(text)) {
    return {
      isStyleEdit: true,
      rule: { operation: 'remove-node' },
      confidence: 1.0,
    };
  }

  // Try each pattern
  for (const { regex, resolve } of PATTERNS) {
    const match = text.match(regex);
    if (match) {
      const rule = resolve(match);
      if (rule) {
        return { isStyleEdit: true, rule, confidence: 0.85 };
      }
    }
  }

  return { isStyleEdit: false };
}

/**
 * Apply a StyleRule to a node's className string.
 * Returns the updated className (or the node mutation instruction).
 */
export function applyStyleRule(
  currentClassName: string,
  rule: StyleRule,
): { className?: string; operation: StyleRule['operation'] } {
  let className = currentClassName;

  switch (rule.operation) {
    case 'add-class':
      if (rule.addClass) {
        className = `${className} ${rule.addClass}`.trim();
        // Deduplicate
        className = [...new Set(className.split(' ').filter(Boolean))].join(' ');
      }
      break;

    case 'remove-class':
      if (rule.removePattern) {
        className = className.replace(new RegExp(rule.removePattern, 'g'), '').replace(/\s+/g, ' ').trim();
      }
      break;

    case 'replace-class':
      if (rule.removePattern) {
        className = className.replace(new RegExp(rule.removePattern, 'g'), '').replace(/\s+/g, ' ').trim();
      }
      if (rule.addClass) {
        className = `${className} ${rule.addClass}`.trim();
        className = [...new Set(className.split(' ').filter(Boolean))].join(' ');
      }
      break;

    default:
      // Non-className operations handled by caller
      break;
  }

  return { className, operation: rule.operation };
}
