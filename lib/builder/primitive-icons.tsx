/**
 * primitive-icons.tsx
 *
 * Lucide-based SVG icon components for each builder primitive type.
 * Used by the components palette and anywhere that needs a primitive icon.
 */
import React from 'react';
import {
  Square,
  Type,
  TextCursor,
  AlignLeft,
  Image,
  Smile,
  Video,
  Globe,
  MousePointer2,
  List,
  ScrollText,
  Link,
  LayoutGrid,
  SlidersHorizontal,
  ToggleLeft,
  CheckSquare,
  ChevronDown,
  Star,
  Map,
  BarChart2,
  Play,
  Code2,
  Table2,
} from 'lucide-react';

export type PrimitiveIconName =
  | 'Box' | 'Text' | 'Input' | 'Textarea' | 'Image' | 'Icon' | 'Video' | 'Iframe'
  | 'Button' | 'List' | 'Scroll' | 'Link' | 'Grid' | 'Slider' | 'Toggle'
  | 'Checkbox' | 'Select' | 'Rating' | 'Map' | 'Chart' | 'Audio' | 'Code' | 'Table';

const iconMap: Record<string, React.ElementType> = {
  Box:      Square,
  Text:     Type,
  Input:    TextCursor,
  Textarea: AlignLeft,
  Image:    Image,
  Icon:     Star,
  Video:    Video,
  Iframe:   Globe,
  Button:   MousePointer2,
  List:     List,
  Scroll:   ScrollText,
  Link:     Link,
  Grid:     LayoutGrid,
  Slider:   SlidersHorizontal,
  Toggle:   ToggleLeft,
  Checkbox: CheckSquare,
  Select:   ChevronDown,
  Rating:   Star,
  Map:      Map,
  Chart:    BarChart2,
  Audio:    Play,
  Code:     Code2,
  Table:    Table2,
  Smile:    Smile,
};

export function PrimitiveIcon({
  type,
  size = 18,
  color = 'currentColor',
}: {
  type: string;
  size?: number;
  color?: string;
}) {
  const Icon = iconMap[type] ?? Square;
  return <Icon size={size} color={color} strokeWidth={1.5} />;
}
