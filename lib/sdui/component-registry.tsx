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

// Interactive
import { Button, ButtonText, ButtonSpinner } from '@/components/ui/button';
import { Pressable } from '@/components/ui/pressable';
import { Link, LinkText } from '@/components/ui/link';

// Feedback
import { Spinner } from '@/components/ui/spinner';
import { Divider } from '@/components/ui/divider';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';

// Overlay — only Tooltip and Menu remain; Modal/Drawer/Popover/AlertDialog/Actionsheet
// are replaced by the generic popup system (see lib/sdui/popup-store.ts + PopupRenderer).
import { Tooltip, TooltipContent, TooltipText } from '@/components/ui/tooltip';
import { Menu, MenuItem, MenuItemLabel, MenuSeparator } from '@/components/ui/menu';

// Form
import { Input, InputField, InputIcon, InputSlot } from '@/components/ui/input';
import { Checkbox, CheckboxGroup, CheckboxIndicator, CheckboxIcon, CheckboxLabel } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Textarea, TextareaInput } from '@/components/ui/textarea';
import { Carousel, CarouselSlide } from '@/lib/sdui/carousel';
import { SearchForm } from '@/components/shared/search-form';
import { CountdownTimer } from '@/lib/sdui/components/CountdownTimer';

// Data display
import { Table, TableHeader, TableBody, TableRow, TableHead, TableData } from '@/components/ui/table';
import { Card } from '@/components/ui/card';
import { Badge, BadgeText, BadgeIcon } from '@/components/ui/badge';
import { Alert, AlertText, AlertIcon } from '@/components/ui/alert';
import { Avatar, AvatarImage, AvatarFallbackText } from '@/components/ui/avatar';

// Scroll
import { ScrollView } from '@/components/ui/scroll-view';
import { SafeAreaView } from '@/components/ui/safe-area-view';

import { View } from '@/components/ui/view';
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
import { SocialIcon } from '@/components/ui/social-icon';


// Accordion
import {
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionTrigger,
  AccordionTitleText,
  AccordionContentText,
  AccordionIcon,
  AccordionContent,
} from '@/components/ui/accordion';

// Select
import {
  Select,
  SelectTrigger,
  SelectInput,
  SelectIcon,
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
import { Radio, RadioGroup, RadioIndicator, RadioLabel, RadioIcon } from '@/components/ui/radio';

// Progress
import { Progress, ProgressFilledTrack } from '@/components/ui/progress';

// Slider
import { Slider, SliderThumb, SliderTrack, SliderFilledTrack } from '@/components/ui/slider';

// FAB
import { Fab, FabLabel, FabIcon } from '@/components/ui/fab';

// Note: BottomSheet requires react-native-gesture-handler & react-native-reanimated - add when deps installed

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
  Card,
  Heading,
  Pressable,
  Divider,
  Spinner,
  Button,
  ButtonText,
  ButtonSpinner,
  Image: NextImage,
  HtmlContent,
  SocialIcon,
  Link,
  LinkText,
  FormContainer,
  Input: InputWithField,
  InputField: InputField,
  InputIcon,
  InputSlot,
  Tooltip,
  TooltipContent,
  TooltipText,
  Menu,
  MenuItem,
  MenuItemLabel,
  MenuSeparator,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableData,
  Checkbox,
  CheckboxGroup,
  CheckboxIndicator,
  CheckboxIcon,
  CheckboxLabel,
  Switch,
  Textarea,
  TextareaInput,
  Badge,
  BadgeText,
  BadgeIcon,
  Alert,
  AlertText,
  AlertIcon,
  Skeleton,
  SkeletonText,
  Avatar,
  AvatarImage,
  AvatarFallbackText,
  ScrollView,
  SafeAreaView,
  // Additional components
  View,
  Icon: IconifyIcon,
  LottiePlayer,
  Video,
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
  AccordionTitleText,
  AccordionContentText,
  AccordionIcon,
  AccordionContent,
  Select,
  SelectTrigger,
  SelectInput,
  SelectIcon,
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
  RadioIcon,
  Progress,
  ProgressFilledTrack,
  Slider,
  SliderThumb,
  SliderTrack,
  SliderFilledTrack,
  Fab,
  FabLabel,
  FabIcon,
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
