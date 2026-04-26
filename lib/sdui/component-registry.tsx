/**
 * SDUI Component Registry — runtime types referenced by JSON `type` fields.
 *
 * The list is deliberately small. Anything that can be expressed as a System
 * Component (built from the primitives below) lives in
 * `lib/builder/system-components/` instead — `Select`, `Tooltip`, the old
 * `FileUpload`, and the `FileInput` primitive (replaced by the `pickFile`
 * workflow step) were removed for that reason.
 *
 * Every entry here has a corresponding palette row in
 * `lib/builder/primitive-components.ts` (or is reachable through one of the
 * System Components built on top of these primitives).
 */

// Layout + Typography
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';

// Feedback
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';

// Form
import { Checkbox, CheckboxGroup, CheckboxIndicator, CheckboxLabel } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Textarea, TextareaInput } from '@/components/ui/textarea';

// Composite components
import { NextImage, HtmlContent, InputWithField } from './components';
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

// Radio
import { Radio, RadioGroup, RadioIndicator, RadioLabel } from '@/components/ui/radio';

// Progress
import { Progress, ProgressFilledTrack } from '@/components/ui/progress';

// Slider
import { Slider, SliderThumb, SliderTrack, SliderFilledTrack } from '@/components/ui/slider';

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
  Textarea,
  TextareaInput,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  RadioGroup,
  Radio,
  RadioIndicator,
  RadioLabel,
  Progress,
  ProgressFilledTrack,
  Switch,
  Checkbox,
  CheckboxIndicator,
  CheckboxLabel,
  CheckboxGroup,
  // Feedback
  Skeleton,
  SkeletonText,
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
