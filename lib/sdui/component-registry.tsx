/**
 * SDUI Component Registry — the trimmed builder-palette keep-list plus a few
 * user-approved escape hatches (LottiePlayer, HtmlContent). Everything here
 * has a corresponding entry in the builder palette (see
 * `lib/builder/primitive-components.ts`) or is an approved leaf widget.
 */

// Layout + Typography
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';

// Feedback
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';

// Overlay
import { Tooltip, TooltipContent, TooltipText } from '@/components/ui/tooltip';

// Form
import { Input } from '@/components/ui/input';
import { Checkbox, CheckboxGroup, CheckboxIndicator, CheckboxLabel } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Textarea, TextareaInput } from '@/components/ui/textarea';

// Composite components
import { NextImage, HtmlContent, InputWithField } from './components';
import IconifyIcon from './components/IconifyIcon';
import LottiePlayer from './components/LottiePlayer';
import Video from './components/Video';
import { FormContainer } from './components/FormContainer';
import FileUpload from './components/FileUpload';
import Iframe from './components/Iframe';
import Chart from './components/Chart';
import QRCodeWidget from './components/QRCodeWidget';
import MarkdownViewer from './components/MarkdownViewer';
import GoogleMap from './components/GoogleMap';
import GoogleMapPlaces from './components/GoogleMapPlaces';

// Select
import {
  Select,
  SelectTrigger,
  SelectInput,
  SelectPortal,
  SelectBackdrop,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

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
  Select,
  SelectTrigger,
  SelectInput,
  SelectPortal,
  SelectBackdrop,
  SelectContent,
  SelectItem,
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
  // Feedback / Overlay
  Tooltip,
  TooltipContent,
  TooltipText,
  Skeleton,
  SkeletonText,
  // Tier 3 — HTML input wrappers
  FileUpload,
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
