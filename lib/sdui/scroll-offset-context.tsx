'use client';

import { createContext, useContext } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

/**
 * ScrollOffsetContext — provides the current page scroll offset (in px) as a
 * Reanimated SharedValue so AnimatedNode can drive parallax and scrollProgress
 * cross-platform without window.scroll listeners.
 *
 * Usage (provider, in page/layout):
 *   const scrollY = useSharedValue(0);
 *   <ScrollOffsetContext.Provider value={scrollY}>
 *     <Animated.ScrollView onScroll={useAnimatedScrollHandler(e => { scrollY.value = e.contentOffset.y; })} scrollEventThrottle={16}>
 *       {children}
 *     </Animated.ScrollView>
 *   </ScrollOffsetContext.Provider>
 *
 * Usage (consumer, in AnimatedNode):
 *   const scrollY = useScrollOffset();   // SharedValue<number>
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ScrollOffsetContext = createContext<SharedValue<number>>(null as any);

export function useScrollOffset(): SharedValue<number> | null {
  return useContext(ScrollOffsetContext);
}

export { ScrollOffsetContext };
