'use client';
import type React from 'react';
import Animated from 'react-native-reanimated';

type AnyComponent = React.ComponentType<Record<string, unknown>>;

// Keep one animated wrapper per base component type.
// Re-creating wrappers per render changes the component identity and causes
// avoidable remounts/resets of animated nodes.
const cache = new WeakMap<AnyComponent, AnyComponent>();

export function getAnimatedComponent<T extends AnyComponent>(Component: T): T {
  const existing = cache.get(Component);
  if (existing) return existing as T;
  const animated = Animated.createAnimatedComponent(Component) as unknown as AnyComponent;
  cache.set(Component, animated);
  return animated as T;
}
