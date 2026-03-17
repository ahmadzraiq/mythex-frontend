import React from 'react';
import { View, Text } from 'react-native';

// Native video stub — replace with react-native-video when the dependency is installed:
// import Video from 'react-native-video';
// export default Video;

export interface VideoProps {
  src?: string;
  poster?: string;
  loop?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
  controls?: boolean;
  objectFit?: 'cover' | 'contain' | 'fill';
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: object;
  'data-testid'?: string;
}

export default function Video({ width = '100%', height = 240, style }: VideoProps) {
  return (
    <View style={[{ width: width as number, height: height as number, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' }, style as object]}>
      <Text style={{ color: '#6b7280', fontSize: 13 }}>Video (install react-native-video)</Text>
    </View>
  );
}
