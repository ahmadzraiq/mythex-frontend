/**
 * Stub for react-native-worklets (required by react-native-reanimated v4).
 * On web, worklets run as regular JS functions — these are no-ops that satisfy
 * the import without requiring the native worklet engine.
 */

export function runOnUISync(fn) {
  // On web the "UI thread" is the JS thread; call synchronously
  if (typeof fn === 'function') return fn();
}

export function runOnUI(fn) {
  return (...args) => {
    if (typeof fn === 'function') fn(...args);
  };
}

export function runOnJS(fn) {
  return fn;
}

export function isWorklet() { return false; }

export const WorkletsModule = {
  makeShareableClone: (v) => v,
  scheduleOnUI: (fn) => { if (typeof fn === 'function') fn(); },
};

export default { runOnUISync, runOnUI, runOnJS, isWorklet, WorkletsModule };
