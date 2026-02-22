/**
 * NavIcon and icon mapping - Lucide icons for SDUI JSON
 */

import React from 'react';
import {
  Search,
  User,
  ShoppingBag,
  Menu as MenuIcon,
  Share,
  Globe,
  Heart,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Zap,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Bell,
  Star,
  Package,
  Truck,
  ShieldCheck,
  X,
  Plus,
  Minus,
  ArrowRight,
  LogOut,
  Sun,
  Moon,
  Monitor,
  ShoppingCart,
  Tag,
} from 'lucide-react-native';

export const NAV_ICONS: Record<string, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number; className?: string }>> = {
  Search,
  User,
  ShoppingBag,
  Menu: MenuIcon,
  Share,
  Globe,
  Heart,
  Favourite: Heart,
  Check,
  CheckCircle2,
  CircleDollarSign,
  ShoppingCart,
  Zap,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Bell,
  Star,
  Package,
  Truck,
  ShieldCheck,
  X,
  Plus,
  Minus,
  ArrowRight,
  LogOut,
  Sun,
  Moon,
  Monitor,
  Tag,
};

export const NAMED_SIZE_MAP: Record<string, number> = {
  '2xs': 12,
  xs: 14,
  sm: 16,
  md: 18,
  lg: 20,
  xl: 24,
};

type NavIconProps = {
  icon: string;
  size?: number | string;
  color?: string;
  className?: string;
  [k: string]: unknown;
};

/** Renders a Lucide icon by name. Props: icon, size (number or named string), color, className */
export function NavIcon(props: NavIconProps) {
  const { icon, size = 'sm', color, className, ...rest } = props;
  const IconComponent = icon ? NAV_ICONS[icon] : null;
  if (!IconComponent) return null;
  const numericSize = typeof size === 'number' ? size : (NAMED_SIZE_MAP[size] ?? 16);
  return <IconComponent size={numericSize} color={color} className={className as string} {...(rest as object)} />;
}
