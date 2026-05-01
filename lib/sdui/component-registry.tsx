/**
 * SDUI Component Registry — runtime types referenced by JSON `type` fields.
 *
 * The list covers all primitive types used in SDUI rendering.
 * Shared Components built from these primitives live in
 * `lib/builder/shared-component-data.ts`.
 *
 * Every entry here has a corresponding palette row in
 * `lib/builder/primitive-components.ts`.
 */

// Layout + Typography
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';

// Composite components
import { NextImage, HtmlContent, InputWithField, TextareaWithInput } from './components';
import IconifyIcon from './components/IconifyIcon';
import LottiePlayer from './components/LottiePlayer';
import Video from './components/Video';
import { FormContainer } from './components/FormContainer';
import Iframe from './components/Iframe';
import Chart from './components/Chart';
import QRCodeWidget from './components/QRCodeWidget';
import MarkdownViewer from './components/MarkdownViewer';
import GoogleMap from './components/GoogleMap';
import GoogleMapPlaces from './components/GoogleMapPlaces';

import type React from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- registry accepts dynamic props from JSON
type RegistryComponent = React.ComponentType<any>;

/** Registry — supports any component type, returns null for unknown. */
export const COMPONENT_REGISTRY: Record<string, RegistryComponent> = {
  // Layout / Typography
  Box,
  Text,
  Icon: IconifyIcon,
  Image: NextImage,
  Video,
  // Forms
  FormContainer,
  Input: InputWithField,
  Textarea: TextareaWithInput,
  // Tier 3 — HTML input wrappers
  Iframe,
  // Tier 4 — Library-dependent
  Chart,
  QRCodeWidget,
  MarkdownViewer,
  GoogleMap,
  GoogleMapPlaces,
  // Approved escape hatches — no Box/Text equivalent
  LottiePlayer,
  HtmlContent,
};

export function getComponent(type: string): RegistryComponent | null {
  return COMPONENT_REGISTRY[type] ?? null;
}
