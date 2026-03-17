/**
 * Popup Store — manages open popup instances at runtime.
 *
 * Each instance has:
 *  - instanceId: unique ID for this open occurrence
 *  - modelId:    which popup model to render
 *  - props:      dynamic properties passed when opening
 *  - waitClose:  when true, openInstance() returns a Promise that resolves
 *                when the instance is closed (enables "Wait close event")
 *  - resolve:    the Promise resolver (set internally when waitClose=true)
 */

import { create } from 'zustand';

export interface PopupInstance {
  instanceId: string;
  modelId: string;
  props: Record<string, unknown>;
  waitClose: boolean;
  resolve?: (returnData: unknown) => void;
}

interface PopupStoreState {
  instances: PopupInstance[];
  openInstance: (
    modelId: string,
    props: Record<string, unknown>,
    waitClose: boolean,
    resolve?: (returnData: unknown) => void
  ) => string;
  closeInstance: (instanceId: string, returnData?: unknown) => void;
  closeAllPopups: (returnData?: unknown) => void;
  closeByModelId: (modelId: string, returnData?: unknown) => void;
  getInstancesByModel: (modelId: string) => PopupInstance[];
  /** Merge new props into all instances of a given model (used by builder to refresh default values). */
  updateInstanceProps: (modelId: string, props: Record<string, unknown>) => void;
}

let instanceCounter = 0;

export const usePopupStore = create<PopupStoreState>((set, get) => ({
  instances: [],

  openInstance: (modelId, props, waitClose, resolve) => {
    const instanceId = `popup-${++instanceCounter}-${Date.now()}`;
    const instance: PopupInstance = { instanceId, modelId, props, waitClose, resolve };
    set(state => ({ instances: [...state.instances, instance] }));
    return instanceId;
  },

  closeInstance: (instanceId, returnData) => {
    const inst = get().instances.find(i => i.instanceId === instanceId);
    if (inst?.resolve) inst.resolve(returnData ?? null);
    set(state => ({ instances: state.instances.filter(i => i.instanceId !== instanceId) }));
  },

  closeAllPopups: (returnData) => {
    get().instances.forEach(inst => {
      if (inst.resolve) inst.resolve(returnData ?? null);
    });
    set({ instances: [] });
  },

  closeByModelId: (modelId, returnData) => {
    get().instances
      .filter(i => i.modelId === modelId)
      .forEach(inst => {
        if (inst.resolve) inst.resolve(returnData ?? null);
      });
    set(state => ({ instances: state.instances.filter(i => i.modelId !== modelId) }));
  },

  getInstancesByModel: (modelId) => {
    return get().instances.filter(i => i.modelId === modelId);
  },

  updateInstanceProps: (modelId, props) => {
    set(state => ({
      instances: state.instances.map(i =>
        i.modelId === modelId ? { ...i, props: { ...i.props, ...props } } : i
      ),
    }));
  },
}));
