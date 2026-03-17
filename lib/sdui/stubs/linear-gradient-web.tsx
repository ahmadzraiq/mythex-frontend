/**
 * Web stub for react-native-linear-gradient.
 * Renders a div with CSS linear-gradient on web.
 * On native (Metro/Expo), the real implementation is resolved automatically.
 */
import React from 'react';

interface LinearGradientProps {
  colors: string[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  angle?: number;
  useAngle?: boolean;
  style?: object;
  children?: React.ReactNode;
  [key: string]: unknown;
}

const LinearGradient: React.FC<LinearGradientProps> = ({
  colors,
  angle = 90,
  useAngle,
  style,
  children,
}) => {
  const deg = useAngle ? angle : 90;
  const gradient = `linear-gradient(${deg}deg, ${colors.join(', ')})`;
  return (
    <div style={{ ...(style as React.CSSProperties), background: gradient }}>
      {children}
    </div>
  );
};

export default LinearGradient;
export { LinearGradient };
