/**
 * SDUI Component Registry - All gluestack-ui components for AI-driven generation
 */

import React from 'react';

// Layout
import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { VStack } from '@/components/ui/vstack';
import { Center } from '@/components/ui/center';
import { Grid, GridItem } from '@/components/ui/grid';

// Typography
import { Text } from '@/components/ui/text';
import { Heading } from '@/components/ui/heading';

// Feedback
import { Spinner } from '@/components/ui/spinner';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';

// Overlay — only Tooltip and Menu remain; Modal/Drawer/Popover/AlertDialog/Actionsheet
// are replaced by the generic popup system (see lib/sdui/popup-store.ts + PopupRenderer).
import { Tooltip, TooltipContent, TooltipText } from '@/components/ui/tooltip';

// Form
import { Input, InputField, InputIcon, InputSlot } from '@/components/ui/input';
import { Checkbox, CheckboxGroup, CheckboxIndicator, CheckboxIcon, CheckboxLabel } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Textarea, TextareaInput } from '@/components/ui/textarea';
import { Carousel, CarouselSlide } from '@/lib/sdui/carousel';
import { CountdownTimer } from '@/lib/sdui/components/CountdownTimer';

// Scroll
import { ScrollView } from '@/components/ui/scroll-view';
import { SafeAreaView } from '@/components/ui/safe-area-view';

import { NextImage, HtmlContent, InputWithField } from './components';
import IconifyIcon from './components/IconifyIcon';
import LottiePlayer from './components/LottiePlayer';
import Video from './components/Video';

// SVG primitive wrappers — let users build any SVG from JSON nodes
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeSvgEl = (tag: string) => (props: any) => React.createElement(tag, props);
const SvgEl          = makeSvgEl('svg');
const SvgPath        = makeSvgEl('path');
const SvgCircle      = makeSvgEl('circle');
const SvgRect        = makeSvgEl('rect');
const SvgEllipse     = makeSvgEl('ellipse');
const SvgLine        = makeSvgEl('line');
const SvgPolygon     = makeSvgEl('polygon');
const SvgPolyline    = makeSvgEl('polyline');
const SvgG           = makeSvgEl('g');
const SvgDefs        = makeSvgEl('defs');
const SvgAnimate     = makeSvgEl('animate');
const SvgAnimateTransform = makeSvgEl('animateTransform');
import { FormContainer } from './components/FormContainer';
import DatePicker from './components/DatePicker';
import TimePicker from './components/TimePicker';
import DateTimePicker from './components/DateTimePicker';
import ColorPicker from './components/ColorPicker';
import FileUpload from './components/FileUpload';
import Iframe from './components/Iframe';
import SvgViewer from './components/SvgViewer';
import JsonViewer from './components/JsonViewer';
import Chart from './components/Chart';
import QRCodeWidget from './components/QRCodeWidget';
import MarkdownViewer from './components/MarkdownViewer';
import GoogleMap from './components/GoogleMap';
import GoogleMapPlaces from './components/GoogleMapPlaces';

// Accordion
import {
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';

// Select
import {
  Select,
  SelectTrigger,
  SelectInput,
  SelectPortal,
  SelectBackdrop,
  SelectContent,
  SelectDragIndicator,
  SelectDragIndicatorWrapper,
  SelectItem,
  SelectScrollView,
  SelectVirtualizedList,
  SelectFlatList,
  SelectSectionList,
  SelectSectionHeaderText,
} from '@/components/ui/select';

// Radio
import { Radio, RadioGroup, RadioIndicator, RadioLabel } from '@/components/ui/radio';

// Progress
import { Progress, ProgressFilledTrack } from '@/components/ui/progress';

// Slider
import { Slider, SliderThumb, SliderTrack, SliderFilledTrack } from '@/components/ui/slider';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- registry accepts dynamic props from JSON
type RegistryComponent = React.ComponentType<any>;

/** Registry - supports any component type, returns null for unknown */
export const COMPONENT_REGISTRY: Record<string, RegistryComponent> = {
  Box,
  Text,
  HStack,
  VStack,
  Center,
  Grid,
  GridItem,
  Heading,
  Spinner,
  Image: NextImage,
  FormContainer,
  Input: InputWithField,
  Tooltip,
  TooltipContent,
  TooltipText,
  Checkbox,
  CheckboxGroup,
  CheckboxIndicator,
  CheckboxLabel,
  Switch,
  Textarea,
  TextareaInput,
  Skeleton,
  SkeletonText,
  ScrollView,
  SafeAreaView,
  Icon: IconifyIcon,
  LottiePlayer,
  Video,
  HtmlContent,
  // SVG primitives — compose any SVG via JSON nodes
  svg: SvgEl,
  path: SvgPath,
  circle: SvgCircle,
  rect: SvgRect,
  ellipse: SvgEllipse,
  line: SvgLine,
  polygon: SvgPolygon,
  polyline: SvgPolyline,
  g: SvgG,
  defs: SvgDefs,
  animate: SvgAnimate,
  animateTransform: SvgAnimateTransform,
  Carousel,
  CarouselSlide,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionTrigger,
  AccordionContent,
  Select,
  SelectTrigger,
  SelectInput,
  SelectPortal,
  SelectBackdrop,
  SelectContent,
  SelectDragIndicator,
  SelectDragIndicatorWrapper,
  SelectItem,
  SelectScrollView,
  SelectVirtualizedList,
  SelectFlatList,
  SelectSectionList,
  SelectSectionHeaderText,
  Radio,
  RadioGroup,
  RadioIndicator,
  RadioLabel,
  Progress,
  ProgressFilledTrack,
  Slider,
  SliderThumb,
  SliderTrack,
  SliderFilledTrack,
  CountdownTimer,
  // Tier 3 — HTML input wrappers
  DatePicker,
  TimePicker,
  DateTimePicker,
  ColorPicker,
  FileUpload,
  Iframe,
  SvgViewer,
  JsonViewer,
  // Tier 4 — Library-dependent
  Chart,
  QRCodeWidget,
  MarkdownViewer,
  GoogleMap,
  GoogleMapPlaces,
};

export function getComponent(type: string): RegistryComponent | null {
  return COMPONENT_REGISTRY[type] ?? null;
}
