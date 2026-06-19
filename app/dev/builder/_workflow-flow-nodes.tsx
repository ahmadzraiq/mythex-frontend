'use client';

/**
 * _workflow-flow-nodes.tsx
 *
 * Step-tree utilities and canvas node components for WorkflowCanvas.
 * Extracted from _workflow-canvas.tsx.
 *
 * Exports (tree helpers):
 *  - getStepAtPath, updateStepAtPath, insertStepAtPath, removeStepAtPath
 *
 * Exports (canvas nodes):
 *  - Connector, InsertButton
 *  - FlowRenderer, ActionNode, PassThroughNode
 *  - BranchNode, MultiOptionBranchNode, LoopNode
 *  - FlowRendererProps (interface)
 */

import React, { useState, useRef, useEffect, useContext, createContext, useMemo } from 'react';
import { S } from './_workflow-styles';
import { type ActionStep, getActionLabel, getActionIcon, isConfigured, canTest, isStepComplete, getStepSummary } from './_workflow-types';
import { useBuilderStore } from './_store';
import { collectPageComponents } from './_formula-editor-tabs';
import type { WorkflowTestEntry } from './_store-types';

// ─── Workflow canvas context — avoids prop-drilling onTestStep / testResults ──

interface WorkflowCanvasCtx {
  onTestStep?: (step: ActionStep, stepPath: (string | number)[]) => void;
  testResults?: Record<string, WorkflowTestEntry>;
}

const WorkflowCanvasContext = createContext<WorkflowCanvasCtx>({});
export { WorkflowCanvasContext };

// ─── Flow step tree helpers ───────────────────────────────────────────────────

export function getStepAtPath(steps: ActionStep[], path: number[]): ActionStep | null {
  if (!path.length) return null;
  const [idx, ...rest] = path;
  const step = steps[idx];
  if (!step) return null;
  if (!rest.length) return step;
  // Navigate into children
  if (rest[0] === -1 && rest[1] !== undefined) {
    // -1 = trueBranch, -2 = falseBranch, -3 = loopBody, -4 = defaultBranch
    // We encode branch path as [parentIdx, branchCode, ...childPath]
    // branchCode: 0 = trueBranch, 1 = falseBranch, 2+ = branches[n-2], -1 = defaultBranch
    return null; // simplified — full deep navigation handled in FlowRenderer
  }
  return null;
}

export function updateStepAtPath(
  steps: ActionStep[],
  path: number[],
  updater: (s: ActionStep) => ActionStep
): ActionStep[] {
  if (!path.length) return steps;
  const [idx, ...rest] = path;
  if (!rest.length) {
    return steps.map((s, i) => (i === idx ? updater(s) : s));
  }
  return steps.map((s, i) => {
    if (i !== idx) return s;
    // Recurse into sub-collections based on rest[0] being a string tag
    const [tag, ...subPath] = rest as [string, ...number[]];
    if (tag === 'true' && s.trueBranch) return { ...s, trueBranch: updateStepAtPath(s.trueBranch, subPath, updater) };
    if (tag === 'false' && s.falseBranch) return { ...s, falseBranch: updateStepAtPath(s.falseBranch, subPath, updater) };
    if (tag === 'loop' && s.loopBody) return { ...s, loopBody: updateStepAtPath(s.loopBody, subPath, updater) };
    if (tag === 'default' && s.defaultBranch) return { ...s, defaultBranch: updateStepAtPath(s.defaultBranch, subPath, updater) };
    if (tag === 'try' && s.tryBody) return { ...s, tryBody: updateStepAtPath(s.tryBody, subPath, updater) };
    if (tag === 'catch' && s.catchBody) return { ...s, catchBody: updateStepAtPath(s.catchBody, subPath, updater) };
    if (tag === 'finally' && s.finallyBody) return { ...s, finallyBody: updateStepAtPath(s.finallyBody, subPath, updater) };
    if (tag?.startsWith('branch-') && s.branches) {
      const bIdx = parseInt(tag.split('-')[1], 10);
      return { ...s, branches: s.branches.map((b, bi) => bi === bIdx ? { ...b, steps: updateStepAtPath(b.steps, subPath, updater) } : b) };
    }
    return s;
  });
}

export function insertStepAtPath(
  steps: ActionStep[],
  path: number[],
  newStep: ActionStep
): ActionStep[] {
  if (!path.length) return steps;
  if (path.length === 1) {
    const copy = [...steps];
    copy.splice(path[0], 0, newStep);
    return copy;
  }
  const [idx, tag, ...subPath] = path as [number, string, ...number[]];
  return steps.map((s, i) => {
    if (i !== idx) return s;
    if (tag === 'true' && s.trueBranch) return { ...s, trueBranch: insertStepAtPath(s.trueBranch, subPath, newStep) };
    if (tag === 'false' && s.falseBranch) return { ...s, falseBranch: insertStepAtPath(s.falseBranch, subPath, newStep) };
    if (tag === 'loop' && s.loopBody) return { ...s, loopBody: insertStepAtPath(s.loopBody, subPath, newStep) };
    if (tag === 'default' && s.defaultBranch) return { ...s, defaultBranch: insertStepAtPath(s.defaultBranch, subPath, newStep) };
    if (tag === 'try' && s.tryBody) return { ...s, tryBody: insertStepAtPath(s.tryBody, subPath, newStep) };
    if (tag === 'catch' && s.catchBody) return { ...s, catchBody: insertStepAtPath(s.catchBody, subPath, newStep) };
    if (tag === 'finally' && s.finallyBody) return { ...s, finallyBody: insertStepAtPath(s.finallyBody, subPath, newStep) };
    if (tag?.startsWith('branch-') && s.branches) {
      const bIdx = parseInt(tag.split('-')[1], 10);
      return { ...s, branches: s.branches.map((b, bi) => bi === bIdx ? { ...b, steps: insertStepAtPath(b.steps, subPath, newStep) } : b) };
    }
    return s;
  });
}

export function removeStepAtPath(steps: ActionStep[], path: number[]): ActionStep[] {
  if (!path.length) return steps;
  if (path.length === 1) return steps.filter((_, i) => i !== path[0]);
  const [idx, tag, ...subPath] = path as [number, string, ...number[]];
  return steps.map((s, i) => {
    if (i !== idx) return s;
    if (tag === 'true' && s.trueBranch) return { ...s, trueBranch: removeStepAtPath(s.trueBranch, subPath) };
    if (tag === 'false' && s.falseBranch) return { ...s, falseBranch: removeStepAtPath(s.falseBranch, subPath) };
    if (tag === 'loop' && s.loopBody) return { ...s, loopBody: removeStepAtPath(s.loopBody, subPath) };
    if (tag === 'default' && s.defaultBranch) return { ...s, defaultBranch: removeStepAtPath(s.defaultBranch, subPath) };
    if (tag === 'try' && s.tryBody) return { ...s, tryBody: removeStepAtPath(s.tryBody, subPath) };
    if (tag === 'catch' && s.catchBody) return { ...s, catchBody: removeStepAtPath(s.catchBody, subPath) };
    if (tag === 'finally' && s.finallyBody) return { ...s, finallyBody: removeStepAtPath(s.finallyBody, subPath) };
    if (tag?.startsWith('branch-') && s.branches) {
      const bIdx = parseInt(tag.split('-')[1], 10);
      return { ...s, branches: s.branches.map((b, bi) => bi === bIdx ? { ...b, steps: removeStepAtPath(b.steps, subPath) } : b) };
    }
    return s;
  });
}

// ─── Connector component ──────────────────────────────────────────────────────

export function Connector({ showArrow = true }: { showArrow?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={S.vLine} />
      {showArrow && <div style={S.arrowHead} />}
    </div>
  );
}

// ─── Insert button ────────────────────────────────────────────────────────────

export function InsertButton({ onClick }: { onClick: (x: number, y: number) => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={S.vLine} />
      <button
        data-testid="insert-btn"
        style={S.insertBtn(hovered)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={e => { e.stopPropagation(); onClick(e.clientX, e.clientY); }}
        title="Insert action here"
      >
        +
      </button>
      <div style={S.vLine} />
    </div>
  );
}

// ─── FlowRenderer — recursive ─────────────────────────────────────────────────

export interface FlowRendererProps {
  steps: ActionStep[];
  pathPrefix: (string | number)[];
  selectedPath: (string | number)[] | null;
  copiedStep: ActionStep | null;
  onSelect: (path: (string | number)[]) => void;
  onInsert: (insertIdx: number, pathPrefix: (string | number)[], x: number, y: number) => void;
  onContextMenu: (e: React.MouseEvent, step: ActionStep, path: (string | number)[]) => void;
  onUpdateStep: (path: (string | number)[], patch: Partial<ActionStep>) => void;
  /** Callback to run a single step as a test — provided by WorkflowCanvas via context */
  onTestStep?: (step: ActionStep, stepPath: (string | number)[]) => void;
  /** Persisted test results keyed by step ID — provided by WorkflowCanvas via context */
  testResults?: Record<string, WorkflowTestEntry>;
}

export function pathEquals(a: (string | number)[] | null, b: (string | number)[]): boolean {
  if (!a) return false;
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export function FlowRenderer({
  steps,
  pathPrefix,
  selectedPath,
  copiedStep,
  onSelect,
  onInsert,
  onContextMenu,
  onUpdateStep,
}: FlowRendererProps) {
  return (
    <div style={S.flowColumn}>
      {steps.length === 0 && (
        <InsertButton onClick={(x, y) => onInsert(0, pathPrefix, x, y)} />
      )}
      {steps.map((step, idx) => {
        const stepPath = [...pathPrefix, idx];
        const isSelected = pathEquals(selectedPath, stepPath);

        return (
          <React.Fragment key={step.id}>
            {/* Insert button before first item only if there are items */}
            {idx === 0 && steps.length > 0 && (
              <InsertButton onClick={(x, y) => onInsert(0, pathPrefix, x, y)} />
            )}

            {/* Render the step */}
            {(step.type === 'branch') && (
              <BranchNode step={step} stepPath={stepPath} isSelected={isSelected} selectedPath={selectedPath} copiedStep={copiedStep} onSelect={onSelect} onInsert={onInsert} onContextMenu={onContextMenu} onUpdateStep={onUpdateStep} />
            )}
            {(step.type === 'multiOptionBranch') && (
              <MultiOptionBranchNode step={step} stepPath={stepPath} isSelected={isSelected} selectedPath={selectedPath} copiedStep={copiedStep} onSelect={onSelect} onInsert={onInsert} onContextMenu={onContextMenu} onUpdateStep={onUpdateStep} />
            )}
            {(step.type === 'forEach' || step.type === 'whileLoop') && (
              <LoopNode step={step} stepPath={stepPath} isSelected={isSelected} selectedPath={selectedPath} copiedStep={copiedStep} onSelect={onSelect} onInsert={onInsert} onContextMenu={onContextMenu} onUpdateStep={onUpdateStep} />
            )}
            {(step.type === 'passThroughCondition') && (
              <PassThroughNode step={step} stepPath={stepPath} isSelected={isSelected} onSelect={onSelect} onContextMenu={onContextMenu} />
            )}
            {(step.type === 'tryCatch') && (
              <TryCatchNode step={step} stepPath={stepPath} isSelected={isSelected} selectedPath={selectedPath} copiedStep={copiedStep} onSelect={onSelect} onInsert={onInsert} onContextMenu={onContextMenu} onUpdateStep={onUpdateStep} />
            )}
            {!['branch', 'multiOptionBranch', 'forEach', 'whileLoop', 'passThroughCondition', 'tryCatch'].includes(step.type) && (
              <ActionNode step={step} stepPath={stepPath} isSelected={isSelected} onSelect={onSelect} onContextMenu={onContextMenu} />
            )}

            {/* Insert button after each step */}
            <InsertButton onClick={(x, y) => onInsert(idx + 1, pathPrefix, x, y)} />
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Action card node ─────────────────────────────────────────────────────────

export function ActionNode({
  step,
  stepPath,
  isSelected,
  onSelect,
  onContextMenu,
}: {
  step: ActionStep;
  stepPath: (string | number)[];
  isSelected: boolean;
  onSelect: (path: (string | number)[]) => void;
  onContextMenu: (e: React.MouseEvent, step: ActionStep, path: (string | number)[]) => void;
}) {
  const { onTestStep, testResults } = useContext(WorkflowCanvasContext);
  const testResult = testResults?.[step.id];
  const [testing, setTesting] = useState(false);

  // Build lookup maps for variable and collection name resolution in summaries
  const customVars = useBuilderStore(s => s.customVars);
  const pageDataSources = useBuilderStore(s => s.pageDataSources);
  const dsActionsMap = useBuilderStore(s => s.dsActionsMap);
  const pageNodes = useBuilderStore(s => s.pageNodes);
  const workflows = useBuilderStore(s => s.workflows);
  const varLabels = useMemo(() => {
    const map: Record<string, string> = {};
    // Global/custom variables
    for (const v of customVars) {
      const key = v.id ?? (v as { name?: string }).name ?? '';
      const label = (v as { label?: string }).label ?? (v as { name?: string }).name ?? key;
      if (key) map[key] = label;
    }
    // Page-component variables (inputs, form containers)
    const { standalones, formContainers } = collectPageComponents(pageNodes, false);
    for (const { node, insideForm } of standalones) {
      const nodeId = (node as { id?: string }).id;
      if (!nodeId) continue;
      const name = ((node as { name?: string }).name || node.type).trim() || 'Input';
      map[`${nodeId}-value`] = insideForm ? `Form - ${name}` : name;
    }
    for (const { node } of formContainers) {
      const nodeId = (node as { id?: string }).id;
      if (!nodeId) continue;
      const name = ((node as { name?: string }).name || 'Form').trim();
      map[`${nodeId}-form`] = `Form Container - ${name}`;
    }
    // Workflow UUIDs → name (for executeComponentAction summary)
    for (const [id, wf] of Object.entries(workflows as Record<string, import('@/config/types').WorkflowDef>)) {
      if (wf.name) map[id] = wf.name;
    }
    return map;
  }, [customVars, pageNodes, workflows]);
  const collectionNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const ds of pageDataSources) {
      const rich = ds as typeof ds & { _label?: string; _operationName?: string };
      map[ds.id] = rich._label || rich._operationName || ds.name || ds.id;
    }
    // Also map action UUIDs → datasource label (for old-format collectionName configs)
    // dsActionsMap: datasourceUUID → actionUUID, so invert it here
    for (const [dsId, actionId] of Object.entries(dsActionsMap)) {
      if (map[dsId]) {
        map[actionId] = map[dsId];
      }
    }
    return map;
  }, [pageDataSources, dsActionsMap]);

  const unconfigured = !isConfigured(step);
  const complete = !unconfigured && isStepComplete(step);
  const actionIncomplete = !unconfigured && !complete;
  const testable = canTest(step);
  const label = unconfigured ? 'Action' : getActionLabel(step.type);
  const icon = unconfigured ? '⚡' : getActionIcon(step.type);
  const summary = unconfigured ? null : getStepSummary(step, varLabels, collectionNames);
  // subtext: when name exists → "Type · summary"; otherwise just summary. Unconfigured → "Click to configure"
  const subtextLabel = unconfigured
    ? 'Click to configure'
    : (complete
      ? (step.name ? [label, summary].filter(Boolean).join(' · ') : summary)
      : null);

  const handleTest = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onTestStep || !testable || testing) return;
    setTesting(true);
    try {
      await onTestStep(step, stepPath);
    } finally {
      setTesting(false);
    }
  };

  // Badge: show success / error dot after test
  const badge = testResult
    ? testResult.error
      ? { color: 'var(--bld-error)', symbol: '✕', title: `Error: ${testResult.error}` }
      : { color: 'var(--bld-success)', symbol: '✓', title: 'Test passed' }
    : null;

  return (
    <div
      data-testid={`action-node-${step.id}`}
      style={S.card(isSelected, unconfigured)}
      onClick={() => onSelect(stepPath)}
    >
      <div style={S.cardTopRow}>
        <span style={S.cardIcon}>{icon}</span>
        <span style={S.cardName}>{step.name || label}</span>
        {badge && (
          <span title={badge.title} style={{ fontSize: 11, color: badge.color, flexShrink: 0 }}>{badge.symbol}</span>
        )}
        {testable && onTestStep && (
          <button
            data-testid={`test-step-btn-${step.id}`}
            style={{
              background: 'none', border: 'none', cursor: testing ? 'default' : 'pointer',
              color: testing ? 'var(--bld-text-disabled)' : 'var(--bld-text-3)', fontSize: 11, padding: '2px 4px',
              lineHeight: 1, borderRadius: 3, flexShrink: 0,
            }}
            title="Test action"
            onPointerDown={e => e.stopPropagation()}
            onClick={handleTest}
            disabled={testing}
          >
            {testing ? '…' : '▶'}
          </button>
        )}
        <button
          data-testid="context-menu-btn"
          style={S.moreBtn}
          type="button"
          onClick={e => { e.stopPropagation(); onContextMenu(e, step, stepPath); }}
          title="More options"
        >
          ⋮
        </button>
      </div>
      {unconfigured && (
        <div style={S.cardSubtext(true)}>Click to configure</div>
      )}
      {actionIncomplete && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          {step.name && (
            <span style={{ fontSize: 11, color: 'var(--bld-text-3)' }}>{label}</span>
          )}
          <div style={{
            display: 'inline-block',
            background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)',
            borderRadius: 6, padding: '2px 8px',
            fontSize: 11, fontWeight: 500, color: 'var(--bld-warning)',
          }}>
            Action incomplete
          </div>
        </div>
      )}
      {!unconfigured && !actionIncomplete && subtextLabel && (
        <div style={S.cardSubtext(false)}>{subtextLabel}</div>
      )}
      {testResult && (
        <div style={{ fontSize: 10, color: testResult.error ? 'var(--bld-error)' : 'var(--bld-success)', marginTop: 4, fontFamily: 'monospace', maxHeight: 48, overflow: 'hidden', textOverflow: 'ellipsis', wordBreak: 'break-all' }}>
          {testResult.error
            ? `Error: ${testResult.error}`
            : `OK · ${new Date(testResult.ranAt).toLocaleTimeString()}`}
        </div>
      )}
    </div>
  );
}

// ─── Pass through condition (oval shape) ─────────────────────────────────────

export function PassThroughNode({
  step,
  stepPath,
  isSelected,
  onSelect,
  onContextMenu,
}: {
  step: ActionStep;
  stepPath: (string | number)[];
  isSelected: boolean;
  onSelect: (path: (string | number)[]) => void;
  onContextMenu: (e: React.MouseEvent, step: ActionStep, path: (string | number)[]) => void;
}) {
  return (
    <div
      style={{ ...S.pillNode(isSelected, true), gap: 8 }}
      onClick={() => onSelect(stepPath)}
    >
      <span style={{ fontSize: 12 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"middle"}}><polyline points="6 9 12 15 18 9"/></svg></span>
      <span>{step.name || 'Pass through condition'}</span>
      <button
        style={{ ...S.moreBtn, fontSize: 14 }}
        type="button"
        onClick={e => { e.stopPropagation(); onContextMenu(e, step, stepPath); }}
      >
        ⋮
      </button>
    </div>
  );
}

// ─── True/False branch node ───────────────────────────────────────────────────

export function BranchNode({
  step, stepPath, isSelected, selectedPath, copiedStep,
  onSelect, onInsert, onContextMenu, onUpdateStep,
}: {
  step: ActionStep; stepPath: (string | number)[]; isSelected: boolean;
  selectedPath: (string | number)[] | null; copiedStep: ActionStep | null;
  onSelect: (p: (string | number)[]) => void;
  onInsert: (idx: number, prefix: (string | number)[], x: number, y: number) => void;
  onContextMenu: (e: React.MouseEvent, s: ActionStep, p: (string | number)[]) => void;
  onUpdateStep: (p: (string | number)[], patch: Partial<ActionStep>) => void;
}) {
  const trueBranch = step.trueBranch ?? [];
  const falseBranch = step.falseBranch ?? [];
  const BRANCH_W = 280;
  const GAP = 64;
  const totalW = BRANCH_W * 2 + GAP;
  // Fallback constants (used until DOM is measured)
  const fallbackXCenters = [BRANCH_W / 2, totalW - BRANCH_W / 2];

  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<{ xCenters: number[]; heights: number[]; rowW: number }>({
    xCenters: fallbackXCenters,
    heights: [0, 0],
    rowW: totalW,
  });

  useEffect(() => {
    const measure = () => {
      const row = rowRef.current;
      if (!row) return;
      const xCenters = colRefs.current.map(el =>
        el ? (el.offsetLeft - row.offsetLeft) + el.offsetWidth / 2 : 0
      );
      const heights = colRefs.current.map(el => el?.offsetHeight ?? 0);
      setLayout({ xCenters, heights, rowW: row.offsetWidth });
    };

    const observers: ResizeObserver[] = [];
    const targets = [rowRef.current, ...colRefs.current].filter(Boolean) as HTMLDivElement[];
    targets.forEach(el => {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      observers.push(ro);
    });
    measure();

    return () => observers.forEach(ro => ro.disconnect());
  }, []);

  const rowW = layout.rowW || totalW;
  const xL = layout.xCenters[0] ?? fallbackXCenters[0];
  const xR = layout.xCenters[1] ?? fallbackXCenters[1];
  const maxH = layout.heights.length ? Math.max(...layout.heights) : 0;

  return (
    <div data-testid={`action-node-${step.id}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Pill header */}
      <div
        style={S.pillNode(isSelected)}
        onClick={() => onSelect(stepPath)}
      >
        <span>⟐</span>
        <span>{step.name || 'True/False split'}</span>
        <button style={S.moreBtn} type="button" onClick={e => { e.stopPropagation(); onContextMenu(e, step, stepPath); }}>⋮</button>
      </div>
      {/* Top split SVG: center drop → horizontal bar → per-column drops */}
      <svg width={rowW} height={32} style={{ flexShrink: 0, overflow: 'visible' }}>
        <line x1={rowW / 2} y1={0} x2={rowW / 2} y2={16} stroke="var(--bld-border-subtle)" strokeWidth={1} />
        <line x1={xL} y1={16} x2={xR} y2={16} stroke="var(--bld-border-subtle)" strokeWidth={1} />
        <line x1={xL} y1={16} x2={xL} y2={32} stroke="var(--bld-border-subtle)" strokeWidth={1} />
        <line x1={xR} y1={16} x2={xR} y2={32} stroke="var(--bld-border-subtle)" strokeWidth={1} />
      </svg>
      {/* Branch columns */}
      <div ref={rowRef} style={{ display: 'flex', alignItems: 'flex-start', gap: GAP }}>
        {/* True */}
        <div
          ref={el => { colRefs.current[0] = el; }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: BRANCH_W }}
        >
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--bld-success)', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 20, padding: '2px 10px', marginBottom: 6 }}>true</span>
          <FlowRenderer
            steps={trueBranch}
            pathPrefix={[...stepPath, 'true']}
            selectedPath={selectedPath}
            copiedStep={copiedStep}
            onSelect={onSelect}
            onInsert={onInsert}
            onContextMenu={onContextMenu}
            onUpdateStep={onUpdateStep}
          />
        </div>
        {/* False */}
        <div
          ref={el => { colRefs.current[1] = el; }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: BRANCH_W }}
        >
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--bld-error)', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 20, padding: '2px 10px', marginBottom: 6 }}>false</span>
          <FlowRenderer
            steps={falseBranch}
            pathPrefix={[...stepPath, 'false']}
            selectedPath={selectedPath}
            copiedStep={copiedStep}
            onSelect={onSelect}
            onInsert={onInsert}
            onContextMenu={onContextMenu}
            onUpdateStep={onUpdateStep}
          />
        </div>
      </div>
      {/* Rejoin SVG: vertical drops from each column center, single bottom merge bar, center drop */}
      <svg width={rowW} height={36} style={{ flexShrink: 0, overflow: 'visible' }}>
        <line x1={xL} y1={-(maxH - (layout.heights[0] ?? 0))} x2={xL} y2={24} stroke="var(--bld-border-subtle)" strokeWidth={1} />
        <line x1={xR} y1={-(maxH - (layout.heights[1] ?? 0))} x2={xR} y2={24} stroke="var(--bld-border-subtle)" strokeWidth={1} />
        <line x1={xL} y1={24} x2={xR} y2={24} stroke="var(--bld-border-subtle)" strokeWidth={1} />
        <line x1={rowW / 2} y1={24} x2={rowW / 2} y2={36} stroke="var(--bld-border-subtle)" strokeWidth={1} />
      </svg>
      <Connector />
    </div>
  );
}

// ─── Multi-option branch node ─────────────────────────────────────────────────

export function MultiOptionBranchNode({
  step, stepPath, isSelected, selectedPath, copiedStep,
  onSelect, onInsert, onContextMenu, onUpdateStep,
}: {
  step: ActionStep; stepPath: (string | number)[]; isSelected: boolean;
  selectedPath: (string | number)[] | null; copiedStep: ActionStep | null;
  onSelect: (p: (string | number)[]) => void;
  onInsert: (idx: number, prefix: (string | number)[], x: number, y: number) => void;
  onContextMenu: (e: React.MouseEvent, s: ActionStep, p: (string | number)[]) => void;
  onUpdateStep: (p: (string | number)[], patch: Partial<ActionStep>) => void;
}) {
  const branches = step.branches ?? [
    { match: 'First value', steps: [] },
    { match: 'Second value', steps: [] },
    { match: 'Third value', steps: [] },
  ];
  const defaultBranch = step.defaultBranch;
  const allBranches = defaultBranch !== undefined ? [...branches, { match: 'default', steps: defaultBranch }] : branches;
  const BRANCH_W = 260;
  const GAP = 48;
  const totalW = allBranches.length * BRANCH_W + (allBranches.length - 1) * GAP;
  // Fallback constants (used until DOM is measured)
  const fallbackXCenters = allBranches.map((_, bi) => bi * (BRANCH_W + GAP) + BRANCH_W / 2);

  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<{ xCenters: number[]; heights: number[]; rowW: number }>({
    xCenters: fallbackXCenters,
    heights: new Array(allBranches.length).fill(0),
    rowW: totalW,
  });

  useEffect(() => {
    const measure = () => {
      const row = rowRef.current;
      if (!row) return;
      const xCenters = colRefs.current.slice(0, allBranches.length).map(el =>
        el ? (el.offsetLeft - row.offsetLeft) + el.offsetWidth / 2 : 0
      );
      const heights = colRefs.current.slice(0, allBranches.length).map(el => el?.offsetHeight ?? 0);
      setLayout({ xCenters, heights, rowW: row.offsetWidth });
    };

    const observers: ResizeObserver[] = [];
    const targets = [rowRef.current, ...colRefs.current.slice(0, allBranches.length)].filter(Boolean) as HTMLDivElement[];
    targets.forEach(el => {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      observers.push(ro);
    });
    measure();

    return () => observers.forEach(ro => ro.disconnect());
  }, [allBranches.length]);

  const rowW = layout.rowW || totalW;
  const xCenters = layout.xCenters.length === allBranches.length ? layout.xCenters : fallbackXCenters;
  const maxH = layout.heights.length ? Math.max(...layout.heights) : 0;

  return (
    <div data-testid={`action-node-${step.id}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={S.pillNode(isSelected)} onClick={() => onSelect(stepPath)}>
        <span>⟐</span>
        <span>{step.name || 'Multi-option split'}</span>
        <button style={S.moreBtn} type="button" onClick={e => { e.stopPropagation(); onContextMenu(e, step, stepPath); }}>⋮</button>
      </div>
      {/* Top split SVG: center drop → horizontal bar → per-column drops */}
      <svg width={rowW} height={32} style={{ flexShrink: 0, overflow: 'visible' }}>
        <line x1={rowW / 2} y1={0} x2={rowW / 2} y2={16} stroke="var(--bld-border-subtle)" strokeWidth={1} />
        <line x1={xCenters[0]} y1={16} x2={xCenters[xCenters.length - 1]} y2={16} stroke="var(--bld-border-subtle)" strokeWidth={1} />
        {xCenters.map((cx, bi) => (
          <line key={bi} x1={cx} y1={16} x2={cx} y2={32} stroke="var(--bld-border-subtle)" strokeWidth={1} />
        ))}
      </svg>
      <div ref={rowRef} style={{ display: 'flex', alignItems: 'flex-start', gap: GAP }}>
        {allBranches.map((branch, bi) => {
          const branchKey = bi < branches.length ? `branch-${bi}` : 'default';
          return (
            <div
              key={bi}
              ref={el => { colRefs.current[bi] = el; }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: BRANCH_W }}
            >
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 20,
                padding: '2px 10px',
                marginBottom: 6,
                ...(bi >= branches.length
                  ? { color: 'var(--bld-text-3)', background: 'rgba(107,114,128,0.12)', border: '1px solid rgba(107,114,128,0.3)' }
                  : { color: 'var(--bld-accent)', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(165,180,252,0.3)' }),
              }}>
                {branch.match}
              </span>
              <FlowRenderer
                steps={branch.steps}
                pathPrefix={[...stepPath, branchKey]}
                selectedPath={selectedPath}
                copiedStep={copiedStep}
                onSelect={onSelect}
                onInsert={onInsert}
                onContextMenu={onContextMenu}
                onUpdateStep={onUpdateStep}
              />
            </div>
          );
        })}
      </div>
      {/* Rejoin SVG: vertical drops from each column center, single bottom merge bar, center drop */}
      <svg width={rowW} height={36} style={{ flexShrink: 0, overflow: 'visible' }}>
        {xCenters.map((cx, bi) => {
          const drop = layout.heights[bi] != null ? maxH - layout.heights[bi] : 0;
          return <line key={bi} x1={cx} y1={-drop} x2={cx} y2={24} stroke="var(--bld-border-subtle)" strokeWidth={1} />;
        })}
        <line x1={xCenters[0]} y1={24} x2={xCenters[xCenters.length - 1]} y2={24} stroke="var(--bld-border-subtle)" strokeWidth={1} />
        <line x1={rowW / 2} y1={24} x2={rowW / 2} y2={36} stroke="var(--bld-border-subtle)" strokeWidth={1} />
      </svg>
      <Connector />
    </div>
  );
}

// ─── Loop node (Iterator / While) ─────────────────────────────────────────────

export function TryCatchNode({
  step, stepPath, isSelected, selectedPath, copiedStep,
  onSelect, onInsert, onContextMenu, onUpdateStep,
}: {
  step: ActionStep; stepPath: (string | number)[]; isSelected: boolean;
  selectedPath: (string | number)[] | null; copiedStep: ActionStep | null;
  onSelect: (p: (string | number)[]) => void;
  onInsert: (idx: number, prefix: (string | number)[], x: number, y: number) => void;
  onContextMenu: (e: React.MouseEvent, s: ActionStep, p: (string | number)[]) => void;
  onUpdateStep: (p: (string | number)[], patch: Partial<ActionStep>) => void;
}) {
  const tryBody = step.tryBody ?? [];
  const catchBody = step.catchBody ?? [];
  const finallyBody = step.finallyBody ?? [];
  const hasCatch = step.config?.catchEnabled !== false; // default on
  const hasFinally = step.config?.finallyEnabled === true;

  const BRANCH_W = 260;
  const GAP = 40;
  const cols = [tryBody, ...(hasCatch ? [catchBody] : []), ...(hasFinally ? [finallyBody] : [])];
  const colLabels = ['try', ...(hasCatch ? ['catch'] : []), ...(hasFinally ? ['finally'] : [])];
  const colPrefixes = ['try', ...(hasCatch ? ['catch'] : []), ...(hasFinally ? ['finally'] : [])];
  const colColors = ['var(--bld-info)', 'var(--bld-error)', 'var(--bld-warning)'];

  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<{ xCenters: number[]; heights: number[]; rowW: number }>({
    xCenters: cols.map((_, i) => BRANCH_W / 2 + i * (BRANCH_W + GAP)),
    heights: cols.map(() => 0),
    rowW: cols.length * BRANCH_W + (cols.length - 1) * GAP,
  });

  useEffect(() => {
    const measure = () => {
      const row = rowRef.current;
      if (!row) return;
      const xCenters = colRefs.current.map(el =>
        el ? (el.offsetLeft - row.offsetLeft) + el.offsetWidth / 2 : 0
      );
      const heights = colRefs.current.map(el => el?.offsetHeight ?? 0);
      setLayout({ xCenters, heights, rowW: row.offsetWidth });
    };
    const observers: ResizeObserver[] = [];
    const targets = [rowRef.current, ...colRefs.current].filter(Boolean) as HTMLDivElement[];
    targets.forEach(el => { const ro = new ResizeObserver(measure); ro.observe(el); observers.push(ro); });
    measure();
    return () => observers.forEach(ro => ro.disconnect());
  }, [hasCatch, hasFinally]);

  const rowW = layout.rowW || cols.length * (BRANCH_W + GAP);
  const xFirst = layout.xCenters[0] ?? BRANCH_W / 2;
  const xLast = layout.xCenters[cols.length - 1] ?? rowW - BRANCH_W / 2;
  const maxH = layout.heights.length ? Math.max(...layout.heights) : 0;

  return (
    <div data-testid={`action-node-${step.id}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Pill header with dashed border */}
      <div
        style={{ ...S.pillNode(isSelected), border: isSelected ? '1.5px solid var(--bld-accent)' : '1.5px dashed var(--bld-border-subtle)' }}
        onClick={() => onSelect(stepPath)}
      >
        <span>⚡</span>
        <span>{step.name || 'Try/Catch'}</span>
        <button style={S.moreBtn} type="button" onClick={e => { e.stopPropagation(); onContextMenu(e, step, stepPath); }}>⋮</button>
      </div>
      {/* Top split */}
      <svg width={rowW} height={32} style={{ flexShrink: 0, overflow: 'visible' }}>
        <line x1={rowW / 2} y1={0} x2={rowW / 2} y2={16} stroke="var(--bld-border-subtle)" strokeWidth={1} />
        <line x1={xFirst} y1={16} x2={xLast} y2={16} stroke="var(--bld-border-subtle)" strokeWidth={1} />
        {layout.xCenters.map((x, i) => (
          <line key={i} x1={x} y1={16} x2={x} y2={32} stroke="var(--bld-border-subtle)" strokeWidth={1} />
        ))}
      </svg>
      {/* Branch columns */}
      <div ref={rowRef} style={{ display: 'flex', alignItems: 'flex-start', gap: GAP }}>
        {cols.map((colSteps, i) => (
          <div
            key={colLabels[i]}
            ref={el => { colRefs.current[i] = el; }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: BRANCH_W }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, color: colColors[i], background: `${colColors[i]}22`, border: `1px solid ${colColors[i]}55`, borderRadius: 20, padding: '2px 10px', marginBottom: 6 }}>
              {colLabels[i]}
            </span>
            <FlowRenderer
              steps={colSteps}
              pathPrefix={[...stepPath, colPrefixes[i]]}
              selectedPath={selectedPath}
              copiedStep={copiedStep}
              onSelect={onSelect}
              onInsert={onInsert}
              onContextMenu={onContextMenu}
              onUpdateStep={onUpdateStep}
            />
          </div>
        ))}
      </div>
      {/* Rejoin SVG */}
      <svg width={rowW} height={36} style={{ flexShrink: 0, overflow: 'visible' }}>
        {layout.xCenters.map((x, i) => (
          <line key={i} x1={x} y1={-(maxH - (layout.heights[i] ?? 0))} x2={x} y2={24} stroke="var(--bld-border-subtle)" strokeWidth={1} />
        ))}
        <line x1={xFirst} y1={24} x2={xLast} y2={24} stroke="var(--bld-border-subtle)" strokeWidth={1} />
        <line x1={rowW / 2} y1={24} x2={rowW / 2} y2={36} stroke="var(--bld-border-subtle)" strokeWidth={1} />
      </svg>
      <Connector />
    </div>
  );
}

export function LoopNode({
  step, stepPath, isSelected, selectedPath, copiedStep,
  onSelect, onInsert, onContextMenu, onUpdateStep,
}: {
  step: ActionStep; stepPath: (string | number)[]; isSelected: boolean;
  selectedPath: (string | number)[] | null; copiedStep: ActionStep | null;
  onSelect: (p: (string | number)[]) => void;
  onInsert: (idx: number, prefix: (string | number)[], x: number, y: number) => void;
  onContextMenu: (e: React.MouseEvent, s: ActionStep, p: (string | number)[]) => void;
  onUpdateStep: (p: (string | number)[], patch: Partial<ActionStep>) => void;
}) {
  const loopBody = step.loopBody ?? [];
  const icon = step.type === 'whileLoop' ? '∞' : '↻';
  const label = step.type === 'whileLoop' ? 'While loop' : 'Iterator (for loop)';

  const pillRowRef = useRef<HTMLDivElement | null>(null);
  const [pillRowH, setPillRowH] = useState(34);

  useEffect(() => {
    const el = pillRowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPillRowH(el.offsetHeight));
    ro.observe(el);
    setPillRowH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  return (
    <div data-testid={`action-node-${step.id}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Loop pill with play button to the left */}
      <div ref={pillRowRef} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Arrowhead pointing right at the top-left junction — indicates loop-back direction */}
        <div style={{
          width: 0,
          height: 0,
          borderTop: '5px solid transparent',
          borderBottom: '5px solid transparent',
          borderLeft: '8px solid rgb(55, 65, 81)',
          zIndex: 1,
        }} />
        <div style={S.pillNode(isSelected)} onClick={() => onSelect(stepPath)}>
          <span>{icon}</span>
          <span>{step.name || label}</span>
          <button style={S.moreBtn} type="button" onClick={e => { e.stopPropagation(); onContextMenu(e, step, stepPath); }}>⋮</button>
        </div>
      </div>
      {/* Loop body row: left back-arrow | right dashed container */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch' }}>
        {/* Dashed loop body container */}
        <div data-testid="loop-body-container" style={S.loopContainer}>
          <div style={{
           position: 'absolute',
           inset: `-${Math.round(pillRowH / 2)}px 50% 14px 0px`,
           borderLeft: '1px dashed rgb(55, 65, 81)',
           borderTop: '1px dashed rgb(55, 65, 81)',
           borderBottom: '1px dashed rgb(55, 65, 81)',
           zIndex: -1,
          }} />
          <FlowRenderer
            steps={loopBody}
            pathPrefix={[...stepPath, 'loop']}
            selectedPath={selectedPath}
            copiedStep={copiedStep}
            onSelect={onSelect}
            onInsert={onInsert}
            onContextMenu={onContextMenu}
            onUpdateStep={onUpdateStep}
          />
          <div style={S.endLoopLabel}>End Loop</div>
        </div>
      </div>
      <Connector />
    </div>
  );
}

