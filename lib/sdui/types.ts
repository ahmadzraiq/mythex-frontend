/**
 * SDUI (Server-Driven UI) Engine - Type Definitions
 * Defines the JSON schema for rendering UI, logic, and conditions
 */

import type { JsonLogicRules } from 'json-logic-js';

/** All gluestack-ui component types - AI can generate any of these */
export type SDUIComponentType =
  | 'Box'
  | 'Text'
  | 'HStack'
  | 'VStack'
  | 'View'
  | 'Image'
  | 'NextImage'
  | 'SocialIcon'
  | 'Icon'
  | 'Button'
  | 'ButtonText'
  | 'ButtonIcon'
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
  | 'Form'
  | 'FormInputWithLabel'
  | 'FormSubmitButton'
  | 'FormControl'
  | 'FormControlLabel'
  | 'FormControlLabelText'
  | 'FormControlError'
  | 'FormControlErrorText'
  | 'FormControlHelper'
  | 'FormControlHelperText'
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
  /** JSON Logic - only fetch when condition is truthy */
  when?: JsonLogicRules;
}

/** Action payload for setState */
export interface SetStatePayload {
  path: string;
  value?: unknown;
  merge?: boolean;
}

/** Action payload for fetch */
export interface FetchPayload {
  url: string;
  method?: string;
  key: string;
  body?: Record<string, unknown>;
}

/** Action payload for navigate (switch view) */
export interface NavigatePayload {
  view: string;
  state?: Record<string, unknown>;
}

/** Action payload for setStateTemporary (e.g. toast - clears after delay) */
export interface SetStateTemporaryPayload {
  path: string;
  value: unknown;
  clearAfter?: number;
}

/** Action definition for event handlers - action can be any string (resolved from actions.json) */
export interface SDUIAction {
  action: string;
  payload?: SetStatePayload | FetchPayload | NavigatePayload | Record<string, unknown>;
}

/** Validation rule for form fields */
export interface SDUIValidationRule {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

/** Single UI node in the JSON tree */
export interface SDUINode {
  type: SDUIComponentType;
  key?: string;
  condition?: JsonLogicRules;
  map?: string;
  props?: Record<string, unknown>;
  className?: string;
  children?: SDUINode[];
  text?: string | { expr: object; suffix?: string; prefix?: string; template?: string };
  src?: string;
  alt?: string;
  /** Action handlers: onClick, onSubmit, onChange, etc. Can be single action or array */
  actions?: Record<string, SDUIAction | SDUIAction[]>;
  /** Data source - fetch on mount when this node is rendered */
  dataSource?: SDUIDataSource;
  /** Validation rules for form fields - keyed by field path */
  validation?: Record<string, SDUIValidationRule>;
}

/** Full screen/page configuration */
export interface SDUIConfig {
  state?: Record<string, unknown>;
  /** Data sources - fetched when config loads */
  dataSources?: SDUIDataSource[];
  /** Actions to run on mount (e.g. redux_fetchProducts) */
  initActions?: SDUIAction[];
  ui: SDUINode;
  meta?: { title?: string; description?: string };
}

/** Runtime context passed through render tree */
export interface SDUIContext {
  state: Record<string, unknown>;
  setState: (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
  get: (path: string, scope?: Record<string, unknown>) => unknown;
  runAction: (action: SDUIAction | SDUIAction[], event?: unknown, scope?: Record<string, unknown>) => void | Promise<void>;
  fetchData: (ds: SDUIDataSource) => Promise<void>;
}
