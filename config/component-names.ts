/**
 * Valid component type values for UI nodes.
 * Keep in sync with lib/sdui/component-registry.tsx — run `npm run check:component-sync` to verify.
 * Used by schema and AI generators.
 */

export const COMPONENT_NAMES = [
  'Box',
  'Text',
  'Icon',
  'Image',
  'Video',
  'FormContainer',
  'Input',
  'InputField',
  'Textarea',
  'TextareaInput',
  'Iframe',
  'Chart',
  'QRCodeWidget',
  'MarkdownViewer',
  'GoogleMap',
  'GoogleMapPlaces',
  'LottiePlayer',
  'HtmlContent',
] as const;
