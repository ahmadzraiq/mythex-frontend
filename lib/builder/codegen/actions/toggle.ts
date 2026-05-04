interface ToggleStep { type: 'toggle'; path?: string; payload?: { path?: string } }

export function emitToggle(step: ToggleStep): string {
  const path = step.path ?? step.payload?.path ?? '';
  const parts = path.split('.').map(p => JSON.stringify(p));
  return `useStore.setState(s => toggleAtPath(s, [${parts.join(', ')}]));`;
}
