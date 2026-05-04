interface PopoverStep { type: 'openPopover' | 'closePopover' | 'togglePopover'; nodeId?: string; id?: string; payload?: Record<string, unknown> }

export function emitPopover(step: PopoverStep): string {
  const id = step.nodeId ?? step.id ?? step.payload?.nodeId as string ?? step.payload?.id as string ?? '';
  const key = JSON.stringify(id);
  switch (step.type) {
    case 'openPopover':
      return `setPopoverState(s => ({ ...s, [${key}]: true }));`;
    case 'closePopover':
      return `setPopoverState(s => ({ ...s, [${key}]: false }));`;
    case 'togglePopover':
      return `setPopoverState(s => ({ ...s, [${key}]: !s[${key}] }));`;
    default:
      return `/* unknown popover action */`;
  }
}
