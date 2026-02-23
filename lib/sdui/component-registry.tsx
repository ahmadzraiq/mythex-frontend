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
import { Button, ButtonText, ButtonIcon, ButtonSpinner } from '@/components/ui/button';
import { Pressable } from '@/components/ui/pressable';
import { Link, LinkText } from '@/components/ui/link';

// Feedback
import { Spinner } from '@/components/ui/spinner';
import { Divider } from '@/components/ui/divider';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';

// Overlay
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerCloseButton,
} from '@/components/ui/drawer';
import {
  Modal,
  ModalBackdrop,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
} from '@/components/ui/modal';
import { Tooltip, TooltipContent, TooltipText } from '@/components/ui/tooltip';
import {
  Popover,
  PopoverBackdrop,
  PopoverContent,
  PopoverHeader,
  PopoverBody,
  PopoverFooter,
  PopoverCloseButton,
} from '@/components/ui/popover';
import { Menu, MenuItem, MenuItemLabel, MenuSeparator } from '@/components/ui/menu';

// Form
import { Input, InputField, InputIcon, InputSlot } from '@/components/ui/input';
import { Checkbox, CheckboxIndicator, CheckboxIcon, CheckboxLabel } from '@/components/ui/checkbox';
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

// Image
import { Image as UIImage } from '@/components/ui/image';
import { Icon } from '@/components/ui/icon';
import { View } from '@/components/ui/view';
import { NavIcon } from './icons';
import { NextImage, HtmlContent, InputWithField } from './components';
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

// Actionsheet
import {
  Actionsheet,
  ActionsheetContent,
  ActionsheetItem,
  ActionsheetItemText,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
  ActionsheetBackdrop,
  ActionsheetScrollView,
  ActionsheetIcon,
  ActionsheetVirtualizedList,
  ActionsheetFlatList,
  ActionsheetSectionList,
  ActionsheetSectionHeaderText,
} from '@/components/ui/actionsheet';

// AlertDialog
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogCloseButton,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogBody,
  AlertDialogBackdrop,
} from '@/components/ui/alert-dialog';

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
  ButtonIcon,
  ButtonSpinner,
  NextImage,
  Image: UIImage,
  HtmlContent,
  SocialIcon,
  Link,
  LinkText,
  Input: InputWithField,
  InputField,
  InputIcon,
  InputSlot,
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerCloseButton,
  Modal,
  ModalBackdrop,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Tooltip,
  TooltipContent,
  TooltipText,
  Popover,
  PopoverBackdrop,
  PopoverContent,
  PopoverHeader,
  PopoverBody,
  PopoverFooter,
  PopoverCloseButton,
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
  Icon,
  NavIcon,
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
  Actionsheet,
  ActionsheetContent,
  ActionsheetItem,
  ActionsheetItemText,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
  ActionsheetBackdrop,
  ActionsheetScrollView,
  ActionsheetIcon,
  ActionsheetVirtualizedList,
  ActionsheetFlatList,
  ActionsheetSectionList,
  ActionsheetSectionHeaderText,
  AlertDialog,
  AlertDialogContent,
  AlertDialogCloseButton,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogBody,
  AlertDialogBackdrop,
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
};

export function getComponent(type: string): RegistryComponent | null {
  return COMPONENT_REGISTRY[type] ?? null;
}
