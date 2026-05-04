/**
 * actions.test.ts — Snapshot tests for action emitters.
 */

import { describe, it, expect } from 'vitest';
import { emitStep } from '../actions/index';
import type { SymbolMap } from '../types';

function makeSymbols(
  vars: Record<string, string> = {},
  collections: Record<string, string> = {},
  workflows: Record<string, string> = {},
): SymbolMap {
  return {
    vars: new Map(Object.entries(vars)),
    collections: new Map(Object.entries(collections)),
    workflows: new Map(Object.entries(workflows)),
    routes: new Map(),
  };
}

const sym = makeSymbols(
  { 'count-uuid': 'count', 'name-uuid': 'userName' },
  { 'products-uuid': 'products' },
  { 'wf-1': 'submitOrder' },
);

describe('set action', () => {
  it('emits setNestedValue for path-based set', () => {
    const code = emitStep({ type: 'set', path: 'cart.total', value: 0 }, sym);
    expect(code).toContain('setNestedValue');
    expect(code).toContain('"cart"');
    expect(code).toContain('"total"');
    expect(code).toContain('0');
  });

  it('emits setState for flat set without path', () => {
    const code = emitStep({ type: 'setState', value: { loading: true } }, sym);
    expect(code).toContain('setState');
  });
});

describe('setVar action', () => {
  it('emits variables update with resolved ident', () => {
    const code = emitStep({ type: 'setVar', name: 'count-uuid', value: 5 }, sym);
    expect(code).toContain('variables');
    expect(code).toContain('count');
    expect(code).toContain('5');
  });
});

describe('toggle action', () => {
  it('emits toggleAtPath', () => {
    const code = emitStep({ type: 'toggle', path: 'ui.menuOpen' }, sym);
    expect(code).toContain('toggleAtPath');
    expect(code).toContain('"ui"');
    expect(code).toContain('"menuOpen"');
  });
});

describe('increment/decrement', () => {
  it('emits bumpAtPath with +1 for increment', () => {
    const code = emitStep({ type: 'increment', path: 'cart.quantity' }, sym);
    expect(code).toContain('bumpAtPath');
    expect(code).toContain('1');
  });

  it('emits bumpAtPath with -1 for decrement', () => {
    const code = emitStep({ type: 'decrement', path: 'cart.quantity' }, sym);
    expect(code).toContain('bumpAtPath');
    expect(code).toContain('-1');
  });
});

describe('appendToPath', () => {
  it('emits appendToPath', () => {
    const code = emitStep({ type: 'appendToPath', path: 'cart.items', value: { id: '1' } }, sym);
    expect(code).toContain('appendToPath');
    expect(code).toContain('"cart"');
  });
});

describe('removeAt', () => {
  it('emits removeAtPath with index', () => {
    const code = emitStep({ type: 'removeAt', path: 'cart.items', index: 0 }, sym);
    expect(code).toContain('removeAtPath');
    expect(code).toContain('0');
  });
});

describe('navigate', () => {
  it('emits router.push for navigate', () => {
    const code = emitStep({ type: 'navigate', url: '/home' }, sym);
    expect(code).toContain('router.push');
    expect(code).toContain('/home');
  });

  it('emits goToPage lookup', () => {
    const symWithRoute = makeSymbols({}, {}, {});
    symWithRoute.routes.set('home', '/');
    const code = emitStep({ type: 'goToPage', page: 'home' }, symWithRoute);
    expect(code).toContain('router.push');
  });
});

describe('showToast', () => {
  it('emits toast.message for default level', () => {
    const code = emitStep({ type: 'showToast', message: 'Hello!' }, sym);
    expect(code).toContain('toast');
    expect(code).toContain('Hello!');
  });

  it('emits toast.error for error level', () => {
    const code = emitStep({ type: 'showToast', message: 'Error', level: 'error' }, sym);
    expect(code).toContain('toast.error');
  });
});

describe('openPopover / closePopover / togglePopover', () => {
  it('emits setPopoverState open for openPopover', () => {
    const code = emitStep({ type: 'openPopover', nodeId: 'menu-pop' }, sym);
    expect(code).toContain('setPopoverState');
    expect(code).toContain('true');
    expect(code).toContain('menu-pop');
  });

  it('emits setPopoverState false for closePopover', () => {
    const code = emitStep({ type: 'closePopover', nodeId: 'menu-pop' }, sym);
    expect(code).toContain('false');
  });
});

describe('setTheme', () => {
  it('emits setTheme call', () => {
    const code = emitStep({ type: 'setTheme', mode: 'dark' }, sym);
    expect(code).toContain('setTheme');
    expect(code).toContain('dark');
  });
});

describe('form actions', () => {
  it('emits form.trigger for validate', () => {
    const code = emitStep({ type: 'validate', field: 'email' }, sym);
    expect(code).toContain('form?.trigger');
    expect(code).toContain('email');
  });

  it('emits form.reset for resetForm', () => {
    const code = emitStep({ type: 'resetForm' }, sym);
    expect(code).toContain('form?.reset');
  });

  it('emits form.setValue for setFormState', () => {
    // config.path is the canonical location for the field key
    const code = emitStep({ type: 'setFormState', config: { path: 'local.data.form.email' }, value: 'test@test.com' }, sym);
    expect(code).toContain('form?.setValue');
    expect(code).toContain('email');
  });
});

describe('mergeAtPath', () => {
  it('emits mergeAtPath', () => {
    const code = emitStep({ type: 'mergeAtPath', path: 'user.profile', value: { name: 'Alice' } }, sym);
    expect(code).toContain('mergeAtPath');
    expect(code).toContain('"user"');
    expect(code).toContain('"profile"');
  });
});

describe('cycleIndex', () => {
  it('emits cycleAtPath', () => {
    const code = emitStep({ type: 'cycleIndex', path: 'carousel.index', length: 5 }, sym);
    expect(code).toContain('cycleAtPath');
    expect(code).toContain('5');
  });
});

describe('sharedComponent actions', () => {
  it('emits addSharedComponent state update', () => {
    const code = emitStep({ type: 'addSharedComponent', id: 'sc-123' }, sym);
    expect(code).toContain('sharedComponents');
    expect(code).toContain('true');
  });

  it('emits deleteAllSharedComponents', () => {
    const code = emitStep({ type: 'deleteAllSharedComponents' }, sym);
    expect(code).toContain('sharedComponents: {}');
  });
});

describe('unknown action type', () => {
  it('emits a comment for unknown action types (never throws)', () => {
    const code = emitStep({ type: 'completelyUnknownAction' }, sym);
    expect(code).toContain('unhandled action type');
    expect(code).toContain('completelyUnknownAction');
  });
});
