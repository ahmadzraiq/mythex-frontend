/**
 * Shared Component Instance Store — manages dynamically added shared component
 * instances at runtime.
 *
 * Each instance has:
 *  - instanceId:   unique ID for this occurrence
 *  - componentId:  which shared component model to render
 *  - props:        dynamic properties passed when adding
 *  - waitClose:    when true, addInstance returns a Promise that resolves
 *                  when the instance is deleted (enables "Wait close event")
 *  - resolve:      the Promise resolver (set internally when waitClose=true)
 */

import { create } from 'zustand';

export interface SharedComponentInstance {
  instanceId: string;
  componentId: string;
  props: Record<string, unknown>;
  waitClose: boolean;
  resolve?: (returnData: unknown) => void;
}

interface SharedComponentInstanceStoreState {
  instances: SharedComponentInstance[];
  addInstance: (
    componentId: string,
    props: Record<string, unknown>,
    waitClose: boolean,
    resolve?: (returnData: unknown) => void,
  ) => string;
  removeInstance: (instanceId: string, returnData?: unknown) => void;
  removeByComponentId: (componentId: string, returnData?: unknown) => void;
  removeAll: (returnData?: unknown) => void;
  getInstancesByComponent: (componentId: string) => SharedComponentInstance[];
  /** Merge new props into all instances of a given component (used by builder to refresh default values). */
  updateInstanceProps: (componentId: string, props: Record<string, unknown>) => void;
}

let instanceCounter = 0;

export const useSharedComponentInstanceStore = create<SharedComponentInstanceStoreState>((set, get) => ({
  instances: [],

  addInstance: (componentId, props, waitClose, resolve) => {
    const instanceId = `sc-inst-${++instanceCounter}-${Date.now()}`;
    const instance: SharedComponentInstance = { instanceId, componentId, props, waitClose, resolve };
    set(state => ({ instances: [...state.instances, instance] }));
    return instanceId;
  },

  removeInstance: (instanceId, returnData) => {
    const inst = get().instances.find(i => i.instanceId === instanceId);
    if (inst?.resolve) inst.resolve(returnData ?? null);
    set(state => ({ instances: state.instances.filter(i => i.instanceId !== instanceId) }));
  },

  removeByComponentId: (componentId, returnData) => {
    get().instances
      .filter(i => i.componentId === componentId)
      .forEach(inst => {
        if (inst.resolve) inst.resolve(returnData ?? null);
      });
    set(state => ({ instances: state.instances.filter(i => i.componentId !== componentId) }));
  },

  removeAll: (returnData) => {
    get().instances.forEach(inst => {
      if (inst.resolve) inst.resolve(returnData ?? null);
    });
    set({ instances: [] });
  },

  getInstancesByComponent: (componentId) => {
    return get().instances.filter(i => i.componentId === componentId);
  },

  updateInstanceProps: (componentId, props) => {
    set(state => ({
      instances: state.instances.map(i =>
        i.componentId === componentId ? { ...i, props: { ...i.props, ...props } } : i,
      ),
    }));
  },
}));
