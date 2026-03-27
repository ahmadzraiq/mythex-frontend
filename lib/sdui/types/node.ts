/**
 * SDUI node and action types - JSON tree structure
 */

import type { SetStatePayload, FetchPayload, NavigatePayload } from './payloads';

/** Condition: formula string, e.g. "cart.count > 0" or "{{demo.number}} >= 60" */
type ConditionValue = string | Record<string, unknown>;

/** All gluestack-ui component types - AI can generate any of these */
export type SDUIComponentType =
  | 'Box'
  | 'Text'
  | 'HStack'
  | 'VStack'
  | 'View'
  | 'Image'
  | 'SocialIcon'
  | 'Icon'
  | 'Button'
  | 'ButtonText'
  | 'ButtonSpinner'
  | 'Card'
  | 'Heading'
  | 'Pressable'
  | 'Center'
  | 'Grid'
  | 'GridItem'
  | 'Divider'
  | 'Spinner'
  | 'Input'
  | 'InputField'
  | 'InputIcon'
  | 'Link'
  | 'LinkText'
  | 'Drawer'
  | 'DrawerBackdrop'
  | 'DrawerContent'
  | 'DrawerHeader'
  | 'DrawerBody'
  | 'DrawerFooter'
  | 'DrawerCloseButton'
  | 'Modal'
  | 'ModalBackdrop'
  | 'ModalContent'
  | 'ModalHeader'
  | 'ModalBody'
  | 'ModalFooter'
  | 'ModalCloseButton'
  | 'Tooltip'
  | 'TooltipContent'
  | 'TooltipText'
  | 'Popover'
  | 'PopoverBackdrop'
  | 'PopoverContent'
  | 'PopoverHeader'
  | 'PopoverBody'
  | 'PopoverFooter'
  | 'PopoverCloseButton'
  | 'Menu'
  | 'MenuItem'
  | 'MenuItemLabel'
  | 'MenuSeparator'
  | 'Checkbox'
  | 'CheckboxIndicator'
  | 'CheckboxIcon'
  | 'CheckboxLabel'
  | 'Switch'
  | 'Textarea'
  | 'TextareaInput'
  | 'Badge'
  | 'BadgeText'
  | 'BadgeIcon'
  | 'Alert'
  | 'AlertText'
  | 'AlertIcon'
  | 'Skeleton'
  | 'SkeletonText'
  | 'Avatar'
  | 'AvatarImage'
  | 'AvatarFallbackText'
  | 'Table'
  | 'TableHeader'
  | 'TableBody'
  | 'TableRow'
  | 'TableHead'
  | 'TableData'
  | 'ScrollView'
  | 'SafeAreaView'
  | 'Accordion'
  | 'AccordionItem'
  | 'AccordionHeader'
  | 'AccordionTrigger'
  | 'AccordionTitleText'
  | 'AccordionContentText'
  | 'AccordionIcon'
  | 'AccordionContent'
  | 'Actionsheet'
  | 'ActionsheetContent'
  | 'ActionsheetItem'
  | 'ActionsheetItemText'
  | 'ActionsheetDragIndicator'
  | 'ActionsheetDragIndicatorWrapper'
  | 'ActionsheetBackdrop'
  | 'ActionsheetScrollView'
  | 'ActionsheetIcon'
  | 'ActionsheetVirtualizedList'
  | 'ActionsheetFlatList'
  | 'ActionsheetSectionList'
  | 'ActionsheetSectionHeaderText'
  | 'AlertDialog'
  | 'AlertDialogContent'
  | 'AlertDialogCloseButton'
  | 'AlertDialogHeader'
  | 'AlertDialogFooter'
  | 'AlertDialogBody'
  | 'AlertDialogBackdrop'
  | 'Select'
  | 'SelectTrigger'
  | 'SelectInput'
  | 'SelectIcon'
  | 'SelectPortal'
  | 'SelectBackdrop'
  | 'SelectContent'
  | 'SelectDragIndicator'
  | 'SelectDragIndicatorWrapper'
  | 'SelectItem'
  | 'SelectScrollView'
  | 'SelectVirtualizedList'
  | 'SelectFlatList'
  | 'SelectSectionList'
  | 'SelectSectionHeaderText'
  | 'Radio'
  | 'RadioGroup'
  | 'RadioIndicator'
  | 'RadioLabel'
  | 'RadioIcon'
  | 'Progress'
  | 'ProgressFilledTrack'
  | 'Slider'
  | 'SliderThumb'
  | 'SliderTrack'
  | 'SliderFilledTrack'
  | 'Fab'
  | 'FabLabel'
  | 'FabIcon'
  | 'WebInput';

/** Data source - fetch from API and store in state */
export interface SDUIDataSource {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  key: string; // state key to store response
  /** Refetch when this state path changes */
  dependsOn?: string;
  /** Condition - only fetch when truthy (formula string) */
  when?: ConditionValue;
}

/** Action definition for event handlers - action can be any string (resolved from actions.json) */
export interface SDUIAction {
  action: string;
  payload?: SetStatePayload | FetchPayload | NavigatePayload | Record<string, unknown>;
}

/** Single UI node in the JSON tree */
export interface SDUINode {
  type: SDUIComponentType;
  /** Stable identifier — used by visual builder for selection & annotation */
  id?: string;
  /** User-visible display name shown in the formula editor's component picker */
  name?: string;
  key?: string;
  condition?: ConditionValue;
  map?: string;
  props?: Record<string, unknown>;
  className?: string;
  children?: SDUINode[];
  text?: string | { expr: object; suffix?: string; prefix?: string; template?: string };
  src?: string;
  alt?: string;
  /**
   * Action handlers.
   * Array format (preferred): each item is a workflow ref; trigger is read from the workflow
   * definition and the correct event (click/change/valueChange/etc.) is bound automatically.
   * Object format (legacy): keys are event names, values are action refs.
   */
  actions?: SDUIAction[] | Record<string, SDUIAction | SDUIAction[]>;
  /** Data source - fetch on mount when this node is rendered */
  dataSource?: SDUIDataSource;
  /** Initial value for form field — used by FormContainer.registerField on mount */
  _initialValue?: unknown;
  /** Overlay rendered on top of the element when props.disabled is truthy */
  _disabledOverlay?: { color?: string; opacity?: number; blur?: number };
  /** When disabled is formula-bound, force the overlay to render in the builder canvas */
  _forceDisabledInEditor?: boolean;
}
