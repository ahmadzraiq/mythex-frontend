/**
 * Flat list of component labels from PRIMITIVE_COMPONENTS in _components-tab.tsx.
 * Used in AI prompts for generate-sections so the AI picks from real builder vocabulary.
 * Update this list when new components are added to the builder panel.
 */
export const SDUI_COMPONENT_LABELS: string[] = [
  // Layout
  'Box', 'Row', 'VStack', 'HStack', 'Center', 'Grid', 'Card', 'Divider', 'ScrollView',
  // Typography
  'Text', 'Heading', 'Label', 'Caption', 'Link',
  // Buttons & Pressable
  'Btn Solid', 'Btn Outline', 'Btn Ghost', 'Btn + Icon L', 'Btn + Icon R',
  'Icon Btn', 'Icon Btn Round', 'Link Btn', 'Pressable', 'FAB',
  // Form
  'Form', 'Input', 'Input Search', 'Textarea', 'Select',
  'Slider', 'Radio', 'Radio Group', 'Progress', 'Toggle',
  'Checkbox', 'Checkbox Group', 'Switch',
  // Composite
  'Chip', 'Tag', 'Tabs', 'Stepper', 'Pagination',
  'Star Rating', 'Breadcrumbs', 'Accordion', 'Table', 'Autocomplete', 'Snackbar',
  // Media
  'Image', 'Icon', 'Icon Tap',
  // Data & Media
  'Date Picker', 'Time Picker', 'Color Picker', 'File Upload',
  'Chart', 'QR Code', 'Markdown', 'Google Map',
  // Display
  'Badge', 'Avatar', 'Spinner', 'Alert',
  // Overlays
  'Modal', 'Tooltip', 'Alert Dialog',
];
