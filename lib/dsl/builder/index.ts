/**
 * Builder DSL library — v2 API.
 *
 * All exports are compile-time stubs. The DSL compiler reads the AST and
 * produces SDUI config JSON — no runtime behaviour required.
 *
 * QUICK REFERENCE
 * ───────────────
 * Variables:   export const x = defineVar(initialValue)
 * Workflows:   export const fn = defineWorkflow((args) => { ... })
 * Functions:   export const fmt = defineFunction((n) => `${n}px`)
 * Datasources: export const ds = defineDatasource({ url, method })
 * Components:  export const Card = defineComponent('Card', { props: {...} }, (p) => <JSX/>)
 * Triggers:    export const onLoad = defineTrigger('pageLoad', () => { ... })
 * Pages:       export const home = definePage('/', () => ( <JSX/> ))
 *
 * FLAT PROPS ON BOX / TEXT (no sx={{}} required)
 * ───────────────────────────────────────────────
 * Layout: flex col row grid center flex1 absolute relative fixed sticky
 * Size:   w h minW maxW p px py pt pb pl pr gap gapX gapY radius border
 * Color:  bg borderColor
 * Text:   size color weight align uppercase lowercase textOverflow tracking
 * Grid:   cols colSpan gridRows gridFlow
 * Other:  overflow cursor opacity objectFit shadow z top right bottom left
 *
 * DYNAMIC (formula-bound) STYLES — wrap any prop value in () =>
 * ──────────────────────────────────────────────────────────────
 * <Box bg={() => isActive ? '#007AFF' : '#ccc'}>
 * <Text color={() => score > 80 ? '#34C759' : '#ff3b30'}>
 *
 * RESPONSIVE BREAKPOINTS (desktop-first)
 * ────────────────────────────────────────
 * Base value = all screens. xl/lg/md add overrides for smaller screens.
 *   xl ≤ 1280px   lg ≤ 1024px   md ≤ 768px
 * Element-level:  <Box p={32} lg={{ p: 20 }} md={{ p: 12 }}>
 * Per-property:   <Box p={{ default: 32, lg: 20, md: 12 }} w={{ default: 1200, md: 'full' }}>
 */

// ─── Formula shorthand ────────────────────────────────────────────────────────
// Use () => expr on any prop value to make it runtime-dynamic (formula-driven).

type F<T> = T | (() => T)

// ─── Sx styling prop ──────────────────────────────────────────────────────────

export interface SxProps {
  // Layout
  display?:        F<'flex' | 'grid' | 'block' | 'inline-block' | 'inline' | 'inline-flex' | 'hidden'>
  direction?:      F<'row' | 'col' | 'row-reverse' | 'col-reverse'>
  items?:          F<'start' | 'end' | 'center' | 'stretch' | 'baseline'>
  justify?:        F<'start' | 'end' | 'center' | 'between' | 'around' | 'evenly'>
  wrap?:           'wrap' | 'nowrap' | 'wrap-reverse'
  flex1?:          boolean
  gridCols?:       F<number>
  gridRows?:       number
  gridFlow?:       'row' | 'col' | 'dense' | 'row-dense' | 'col-dense'
  colSpan?:        F<number>
  colSpanFull?:    boolean
  rowSpan?:        number
  gap?:            F<number>
  gapX?:           F<number>
  gapY?:           F<number>
  self?:           'auto' | 'start' | 'center' | 'end' | 'stretch' | 'baseline'
  // Size
  w?:              F<number | 'full' | 'screen' | 'fit' | 'auto'>
  h?:              F<number | 'full' | 'screen' | 'fit' | 'auto'>
  minW?:           F<number | 'full' | 'fit' | 'auto'>
  maxW?:           F<number | 'full' | 'fit'>
  minH?:           F<number | 'full' | 'screen' | 'fit' | 'auto'>
  maxH?:           F<number | 'full' | 'screen' | 'fit' | 'auto'>
  // Spacing
  p?:              F<number>
  px?:             F<number>
  py?:             F<number>
  pt?:             F<number>
  pr?:             F<number>
  pb?:             F<number>
  pl?:             F<number>
  m?:              F<number | 'auto'>
  mx?:             F<number | 'auto'>
  my?:             F<number | 'auto'>
  mt?:             F<number>
  mr?:             F<number>
  mb?:             F<number>
  ml?:             F<number>
  // Color
  /** hex #rrggbb, rgba(...), or var(--theme-*). */
  bg?:             F<string>
  // Typography
  /** font-size in px */
  text?:           F<number>
  /** hex #rrggbb, rgba(...), or var(--theme-*). */
  textColor?:      F<string>
  weight?:         'thin' | 'extralight' | 'light' | 'normal' | 'medium' | 'semibold' | 'bold' | 'extrabold' | 'black'
  leading?:        'none' | 'tight' | 'snug' | 'normal' | 'relaxed' | 'loose'
  tracking?:       'tighter' | 'tight' | 'normal' | 'wide' | 'wider' | 'widest'
  textAlign?:      'left' | 'center' | 'right' | 'justify'
  textDecoration?: 'underline' | 'line-through' | 'no-underline' | 'overline'
  textTransform?:  'uppercase' | 'lowercase' | 'capitalize' | 'normal-case'
  textOverflow?:   'truncate'
  whitespace?:     'nowrap' | 'pre' | 'normal'
  wordBreak?:      'all' | 'words' | 'keep'
  // Border
  border?:         F<number>
  borderStyle?:    'solid' | 'dashed' | 'dotted' | 'double' | 'none'
  /** hex #rrggbb, rgba(...), or var(--theme-*). */
  borderColor?:    F<string>
  /** border-radius in px. Use 999 for pill/circle. */
  radius?:         F<number>
  radiusTL?:       number
  radiusTR?:       number
  radiusBR?:       number
  radiusBL?:       number
  // Position
  position?:       'static' | 'relative' | 'absolute' | 'fixed' | 'sticky'
  inset0?:         boolean
  top?:            F<number>
  right?:          F<number>
  bottom?:         F<number>
  left?:           F<number>
  z?:              number
  // Misc
  overflow?:       F<'hidden' | 'auto' | 'visible' | 'scroll' | 'x-auto' | 'y-auto'>
  cursor?:         'auto' | 'default' | 'pointer' | 'not-allowed' | 'grab' | 'move' | 'text' | 'crosshair'
  /** 0.0–1.0 */
  opacity?:        F<number>
  objectFit?:      'cover' | 'contain' | 'fill' | 'none'
  shadow?:         'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'none'
  /** Extra raw Tailwind tokens. Use sparingly for things not covered above. */
  extra?:          string
}

// ─── Animation prop ───────────────────────────────────────────────────────────

export type AnimationProps = {
  /** Entrance animation on mount */
  enter?: {
    type?: 'fadeIn' | 'slideInUp' | 'slideInDown' | 'slideInLeft' | 'slideInRight' |
           'zoomIn' | 'bounceIn' | 'flipInX' | 'blurIn' | 'glowIn' | 'revealUp' | 'dropIn' | 'riseFade'
    duration?: number
    delay?: number
    easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'backIn' | 'backOut' | 'backInOut'
    stagger?: number
  }
  exit?: {
    type?: 'fadeOut' | 'slideOutUp' | 'slideOutDown' | 'slideOutLeft' | 'slideOutRight' | 'zoomOut' | 'blurOut'
    duration?: number
    delay?: number
  }
  loop?: {
    type?: 'pulse' | 'breathe' | 'float' | 'flash' | 'spin' | 'shake' | 'wiggle' | 'bounce' | 'heartbeat' | 'glowPulse'
    duration?: number
    repeatCount?: number | -1
  }
  scroll?: {
    type?: 'fadeIn' | 'slideInUp' | 'slideInDown' | 'zoomIn'
    duration?: number
    threshold?: number
    once?: boolean
  }
  press?: { scale?: number; opacity?: number; duration?: number }
  hover?: { scale?: number; opacity?: number; y?: number; x?: number; duration?: number }
}

export type ResponsiveProps = SxProps

/** Responsive wrapper: use { default: desktopVal, xl: val, lg: val, md: val } on any style prop. */
export type Responsive<T> = T | { default?: T; xl?: T; lg?: T; md?: T }

// ─── Base props all elements accept ───────────────────────────────────────────
// Flat props: every SxProps key works directly on Box/Text/etc.
// Layout shorthands: flex col row grid center flex1 absolute relative fixed sticky
// Text shorthands: size color align uppercase lowercase

export type BaseProps = SxProps & {
  xl?:        SxProps
  lg?:        SxProps
  md?:        SxProps
  animation?: AnimationProps
  condition?: unknown
  key?:       string | number
  name?:      string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onClick?:   any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange?:  any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSubmit?:  any
  children?:  unknown

  // Layout shorthands (flat prop aliases)
  flex?:      boolean                        // display: flex
  col?:       boolean                        // direction: col  (implies flex)
  row?:       boolean                        // direction: row  (implies flex)
  grid?:      boolean                        // display: grid
  center?:    boolean                        // items: center + justify: center
  flex1?:     boolean                        // flex: 1 fill space (overrides SxProps flex1)
  cols?:      F<number>                      // alias for gridCols
  absolute?:  boolean                        // position: absolute
  relative?:  boolean                        // position: relative
  fixed?:     boolean                        // position: fixed
  sticky?:    boolean                        // position: sticky

  // Text shorthands (flat prop aliases — preferred for Text element)
  size?:      F<number>                      // alias for text (font-size in px)
  color?:     F<string>                      // alias for textColor
  align?:     'left' | 'center' | 'right' | 'justify'  // alias for textAlign
  uppercase?: boolean                        // textTransform: uppercase
  lowercase?: boolean                        // textTransform: lowercase

  // Explicitly banned — use flat props (bg=, h=, p=, etc.) or sx={{}} instead.
  // TypeScript will flag these even though the index signature below accepts any string key.
  style?:     never
  className?: never

  // Allows component-specific attributes (placeholder, src, alt, value, href, etc.)
  // that are not covered by SxProps or the flat-prop shorthands above.
  // DO NOT add style or className here — they are explicitly banned above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

// ─── JSX element identifiers ──────────────────────────────────────────────────

type Comp = (props: BaseProps) => never

function _comp(name: string): Comp {
  const c = {} as Comp
  ;(c as unknown as Record<string, unknown>).__sdui_type = name
  return c
}

export const Box:           Comp = _comp('Box')
export const Text:          Comp = _comp('Text')
export const Input:         Comp = _comp('Input')
export const Textarea:      Comp = _comp('Textarea')
export const Image:         Comp = _comp('Image')
export const Icon:          Comp = _comp('Icon')
export const Video:         Comp = _comp('Video')
export const Iframe:        Comp = _comp('Iframe')
export const FormContainer: Comp = _comp('FormContainer')
export const SC:            Comp = _comp('SC')  // Shared Component ref

// ─── Runtime context ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const params: Record<string, any> = new Proxy({} as Record<string, any>, {
  get: (_t, k) => `__params__${String(k)}`,
})

export const context = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: { data: null as any },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: { props: null as any },
}

// ─── Action helpers ───────────────────────────────────────────────────────────

/**
 * Set a variable value. The compiler detects this call and emits a
 * `changeVariableValue` workflow step.
 *
 * New API — varRef is the exported variable itself:
 *   setVar(display, '0')
 *   setVar(count, count + 1)
 *
 * Old path-string API (still supported):
 *   setVar('store/display', '0')
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setVar<T>(varRef: T | string, value: T): void {
  void varRef; void value
}

/**
 * Navigate to a route. Compiles to a `navigateTo` step.
 *   navigate('/cart')
 *   navigate('/product', { id: item.id })
 *   navigate(-1)   // go back
 */
export function navigate(path: string | number, queryParams?: Record<string, unknown>): void {
  void path; void queryParams
}

/**
 * Fetch a datasource. Compiles to a `fetchCollection` step.
 *   fetch(productsDS)
 *
 * Old path-string API (still supported):
 *   fetch('data/products')
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fetch(datasourceRef: any): void {
  void datasourceRef
}

/**
 * Reference a workflow by path (old API — still supported for backward compat).
 *   onClick={workflow('workflows/handleClick', { key: val })}
 */
export function workflow(path: string, wfParams?: Record<string, unknown>): () => void {
  void path; void wfParams
  return () => {}
}

// ─── Datasource type (for .map() usage) ──────────────────────────────────────

export type DatasourceRef<T = unknown> = {
  map: <R>(fn: (item: T) => R) => R[]
}

// ─── File type declarators ────────────────────────────────────────────────────

/**
 * Declare a reactive variable.
 *
 * Type is inferred from initial value:
 *   defineVar('hello')     → string
 *   defineVar(0)           → number
 *   defineVar(false)       → boolean
 *   defineVar([])          → array
 *   defineVar({})          → object
 *   defineVar<Item[]>([])  → typed array
 *
 * Exported → global UUID, usable from any page or workflow.
 * Not exported → scoped to this file's pages only.
 */
export function defineVar<T>(initial: T): T {
  return initial
}

/**
 * Declare a workflow (sequence of steps).
 *
 * Exported → global, has UUID, callable from elements and other workflows.
 * Not exported → page-scoped, private to this file.
 *
 *   export const addToCart = defineWorkflow((id: string, price: number) => {
 *     setVar(cartCount, cartCount + 1)
 *     navigate('/cart')
 *   })
 *
 *   onClick={addToCart}                  // direct ref
 *   onClick={() => addToCart(id, price)} // with args
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineWorkflow<T extends (...args: any[]) => void>(fn: T): T {
  void fn
  return fn
}

/**
 * Declare a global function (formula helper).
 *
 *   export const formatPrice = defineFunction((n: number) => `$${n.toFixed(2)}`)
 *   export const typeColor   = defineFunction((type: string) =>
 *     type === 'cardio' ? '#ff6b35' : '#007AFF'
 *   )
 *
 * Usage in JSX:
 *   <Text>{formatPrice(item.price)}</Text>
 *   <Box bg={() => typeColor(item.type)}>
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineFunction<T extends (...args: any[]) => any>(fn: T): T {
  return fn
}

// Alias: defineFormula = defineFunction (for backward compat)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineFormula<T extends (...args: any[]) => any>(fn: T): T {
  return fn
}

/**
 * Declare a datasource (REST/GraphQL/static).
 *
 *   export const productsDS = defineDatasource({
 *     url:      'https://api.example.com/products',
 *     method:   'GET',
 *     dataPath: 'data.items',
 *   })
 *
 * Usage in JSX:
 *   {productsDS.map(item => <Box key={item.id}>...</Box>)}
 */
export function defineDatasource<T = unknown>(opts: {
  url:        string
  method?:    'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  dataPath?:  string
  headers?:   Record<string, string>
  body?:      Record<string, unknown>
  folder?:    string
}): DatasourceRef<T> {
  void opts
  return { map: () => [] }
}

/**
 * Declare a Shared Component (SC) — a reusable component with its own UUID
 * and optional scoped state/workflows.
 *
 *   export const ProductCard = defineComponent('ProductCard', {
 *     props: {
 *       title:     { type: 'string', default: '' },
 *       price:     { type: 'number', default: 0  },
 *     }
 *   }, ({ title, price }) => (
 *     <Box flex col>
 *       <Text size={14}>{title}</Text>
 *     </Box>
 *   ))
 *
 * Use in pages with <ProductCard title={item.title} price={item.price} />
 * (use the export name directly as the JSX tag — no <SC id="..."> needed)
 *
 * TRIGGERS — let the parent page bind a workflow to a component event:
 *
 *   export const Btn = defineComponent('Btn', {
 *     props: { label: { type: 'string', default: '' } },
 *     triggers: ['onPress'],
 *   }, ({ label }) => (
 *     <Box onClick={onPress}><Text>{label}</Text></Box>
 *     //         ↑ BARE IDENTIFIER — never context.component.props.onPress
 *   ))
 *   // In pages:  <Btn label="Go" onPress={myWorkflow} />
 *   //   Standard DOM events also work directly without a triggers declaration:
 *   //            <Btn label="Go" onClick={myWorkflow} />
 */
export function defineComponent(
  id: string,
  schema: {
    props?: Record<string, { type: string; default?: unknown; required?: boolean }>
    /**
     * Custom events this component can emit.
     *  - In the render: use the trigger name as a BARE IDENTIFIER on a DOM prop:
     *      <Box onClick={onPress}>   ← onPress is a bare name, NOT context.component.props.onPress
     *  - On instances: pass a workflow reference as a prop with that trigger name:
     *      <Btn onPress={myWorkflow} />
     *  - Standard DOM events (onClick, onChange, etc.) ALWAYS work on instances
     *    without declaring them as triggers.
     */
    triggers?: string[]
    name?: string
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render: (props: any) => any,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  void id; void schema
  return render({})
}

/**
 * Declare an app/page lifecycle trigger.
 *
 *   export const onPageLoad = defineTrigger('pageLoad', () => {
 *     setVar(isLoading, true)
 *     fetch(productsDS)
 *   })
 *
 *   export const onAppLoad = defineTrigger('appLoad', () => { fetch(productsDS) })
 */
export function defineTrigger(
  type: 'pageLoad' | 'appLoad' | 'keydown' | 'keyup' | 'scroll' | 'resize' | 'hashChange' | string,
  fn: () => void,
): void {
  void type; void fn
}

/**
 * Declare a page.
 *
 *   export const home     = definePage('/', () => ( <Box>...</Box> ))
 *   export const products = definePage('/products', () => ( <Box>...</Box> ))
 *
 * Path '/' → canonical name 'home'.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function definePage(path: string, component: () => any): ReturnType<typeof component> {
  void path
  return component()
}

// ─── Old API compat stubs ─────────────────────────────────────────────────────
// These accept the old multi-arg signatures so existing files keep compiling.

export type PageOptions      = { path: string; layout?: string; title?: string }
export type WorkflowOptions  = { path: string; trigger?: string; params?: Record<string, unknown>; pageScope?: string }
export type TriggerOptions   = { type: string; page?: string }
export type ComponentOptions = { id: string; name?: string; props?: Record<string, { type: string; defaultValue?: unknown }> }
export type DatasourceOptions = { path?: string; type?: string; url?: string; method?: string; query?: string; headers?: Record<string, string>; folder?: string }
export type RouteOptions     = { path: string; config: string; name?: string; auth?: boolean; layout?: string }
export type ThemeOptions     = { brand?: string; cssVariables?: { root?: Record<string, string>; dark?: Record<string, string> } }
export type GroupOptions     = { name: string; page: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineGroup(options: GroupOptions, component: () => any): ReturnType<typeof component> {
  void options
  return component()
}

export function defineRoute(options: RouteOptions): RouteOptions { return options }
export function defineTheme(options: ThemeOptions): ThemeOptions { return options }
