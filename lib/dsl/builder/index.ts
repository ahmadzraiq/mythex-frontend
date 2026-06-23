/**
 * Builder DSL library — v3 API (closed, typed).
 *
 * All exports are compile-time stubs. The DSL compiler reads the AST and
 * produces SDUI config JSON — no runtime behaviour required.
 *
 * QUICK REFERENCE
 * ───────────────
 * State:        export const x    = defineVar(initialValue)
 * Workflows:    export const fn   = defineWorkflow((args) => { ... })
 * Functions:    export const fmt  = defineFunction((n) => `${n}px`)
 * Datasources:  export const ds   = defineDatasource<Item>({ url, method })
 * Components:   export const Card = defineComponent('Card', { props: {...} }, (p) => <JSX/>)
 * Triggers:     export const onLoad = defineTrigger('pageLoad', () => { ... })
 * Pages:        export const home = definePage('/', () => ( <JSX/> ))
 *
 * DYNAMIC VALUES — wrap any prop value in () => to make it reactive
 * <Box bg={() => isActive ? '#007AFF' : '#ccc'}>
 * <Text>{() => formatPrice(item.price)}</Text>
 *
 * EVENTS — arrow functions on event props
 * onClick={myWorkflow}                                          — fire workflow
 * onClick={() => myWorkflow({ id: item.id })}                  — fire with named args
 * onClick={() => activeTab = 'dashboard'}                      — set variable
 * onClick={() => count = count + 1}                            — reactive update
 * onChange={e => query = e.value}                              — set from input
 * onClick={() => { if (item.day > 0) selectDay({ iso: item.iso }) }} — conditional
 * onClick={() => { validate(); submit() }}                     — sequence
 *
 * LOOPS — use .map() directly in JSX
 * {products.map((p) => <Card key={p.id} title={p.title} />)}
 * {items.map((item) => { const label = item.name.toUpperCase(); return <Text key={item.id}>{() => label}</Text> })}
 *
 * CONDITIONALS — use && or ternary
 * {isLoggedIn && <Dashboard />}
 * {count > 0 ? <Badge n={count} /> : null}
 *
 * FLAT PROPS ON BOX / TEXT (CSS alias shorthands)
 * DEFAULT: Box is `flex flex-row` (same as web CSS). Use `col` for vertical stacks.
 * Layout: flex col row grid center flex1 absolute relative fixed sticky
 * Size:   w h minW maxW p px py pt pb pl pr gap gapX gapY radius border
 * Color:  bg borderColor
 * Text:   size color weight align uppercase lowercase textOverflow tracking
 * Grid:   cols colSpan gridRows gridFlow
 * Other:  overflow cursor opacity objectFit shadow z top right bottom left
 *
 * RESPONSIVE BREAKPOINTS (desktop-first)
 * Base = all screens. xl ≤ 1280px  lg ≤ 1024px  md ≤ 768px
 * <Box p={32} lg={{ p: 20 }} md={{ p: 12 }}>
 */

type F<T> = T | (() => T)

// ─── Sx styling prop ──────────────────────────────────────────────────────────

export interface SxProps {
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
  w?:              F<number | 'full' | 'screen' | 'fit' | 'auto'>
  h?:              F<number | 'full' | 'screen' | 'fit' | 'auto'>
  minW?:           F<number | 'full' | 'fit' | 'auto'>
  maxW?:           F<number | 'full' | 'fit'>
  minH?:           F<number | 'full' | 'screen' | 'fit' | 'auto'>
  maxH?:           F<number | 'full' | 'screen' | 'fit' | 'auto'>
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
  bg?:             F<string>
  text?:           F<number>
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
  border?:         F<number>
  borderStyle?:    'solid' | 'dashed' | 'dotted' | 'double' | 'none'
  borderColor?:    F<string>
  /** border-radius in px. Use 999 for pill/circle. */
  radius?:         F<number>
  radiusTL?:       number
  radiusTR?:       number
  radiusBR?:       number
  radiusBL?:       number
  position?:       'static' | 'relative' | 'absolute' | 'fixed' | 'sticky'
  inset0?:         boolean
  top?:            F<number>
  right?:          F<number>
  bottom?:         F<number>
  left?:           F<number>
  z?:              number
  overflow?:       F<'hidden' | 'auto' | 'visible' | 'scroll' | 'x-auto' | 'y-auto'>
  cursor?:         'auto' | 'default' | 'pointer' | 'not-allowed' | 'grab' | 'move' | 'text' | 'crosshair'
  opacity?:        F<number>
  objectFit?:      'cover' | 'contain' | 'fill' | 'none'
  shadow?:         'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'none'
  /** Extra raw Tailwind tokens for things not covered above. */
  extra?:          string
}

// ─── Animation prop ───────────────────────────────────────────────────────────

export type AnimationProps = {
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

// ─── Base props all elements accept ───────────────────────────────────────────

export type BaseProps = SxProps & {
  /** Screens ≤ 1280px. Desktop-first: base = largest, xl/lg/md shrink. */
  xl?:        SxProps
  /** Screens ≤ 1024px. */
  lg?:        SxProps
  /** Screens ≤ 768px. */
  md?:        SxProps
  animation?: AnimationProps
  /**
   * Popover — floating panel attached to any Box.
   * Add `popover` on the trigger. Place a child Box with `_popoverContent` inside it.
   *
   * popover={{ trigger: 'click'|'hover', placement: 'bottom-start'|'top'|...,
   *            offset?, closeOnOutsideClick?, closeOnEscape?,
   *            matchTriggerWidth?, openVariable? }}
   *
   * Example:
   *   <Box popover={{ trigger: 'click', placement: 'bottom-start', matchTriggerWidth: true }}>
   *     <Text>Open</Text>
   *     <Box _popoverContent bg="white" border={1} radius={8} py={4}>
   *       <Box onClick={option1} px={16} py={8}><Text>Option 1</Text></Box>
   *     </Box>
   *   </Box>
   */
  popover?:         Record<string, unknown>
  /** Marks this Box as the popover content — rendered inside the floating panel. */
  _popoverContent?: boolean
  key?:       string | number
  name?:      string
  onClick?:   unknown
  onChange?:  unknown
  onSubmit?:  unknown
  children?:  unknown

  // Layout shorthands
  flex?:      boolean   // display: flex
  col?:       boolean   // direction: col (implies flex)
  row?:       boolean   // direction: row (implies flex)
  grid?:      boolean   // display: grid
  center?:    boolean   // items: center + justify: center
  flex1?:     boolean   // flex: 1
  cols?:      F<number> // alias for gridCols
  absolute?:  boolean
  relative?:  boolean
  fixed?:     boolean
  sticky?:    boolean

  // Text shorthands
  size?:      F<number>   // font-size in px
  color?:     F<string>   // textColor
  align?:     'left' | 'center' | 'right' | 'justify'
  uppercase?: boolean
  lowercase?: boolean

  // Banned — use flat props instead
  style?:     never
  className?: never

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

export const Box:  Comp = _comp('Box')
export const Text: Comp = _comp('Text')

/**
 * Input — single-line text field.
 * Form-bound (inside FormContainer): name, type, placeholder, secureTextEntry,
 *   autoComplete, _initialValue, _debounce, _validation
 * Controlled (live binding): value={() => myVar}  onChange={set(myVar, ev.value)}
 *
 * Validation rules: { rule: 'required'|'email'|'phone'|'url'|'minLength'|'maxLength'|'pattern'|'equalsField'|'formula', value?, message }
 */
export const Input: Comp = _comp('Input')

/** Textarea — multi-line text input. Same props as Input (name, _validation, _debounce, etc.). */
export const Textarea: Comp = _comp('Textarea')

/**
 * Icon — Iconify icon.
 * Props: icon (e.g. "lucide:calendar"), size (px number), color (string | () => string)
 * No layout/size/color shorthands from Box — only these three props.
 */
export const Icon: Comp = _comp('Icon')

/**
 * Image — src (URL), alt, objectFit + standard layout/size props (w, h, radius, etc.)
 */
export const Image: Comp = _comp('Image')

/**
 * Video — src (MP4 URL), poster, autoPlay, muted, loop, controls, objectFit
 * Always muted when autoPlay is true (browser requirement).
 */
export const Video:   Comp = _comp('Video')
export const Iframe:  Comp = _comp('Iframe')

/**
 * Chart — data visualization.
 * chartType: 'bar'|'line'|'area'|'pie'|'scatter'
 * data: () => { name, value }[]
 * dataKey, nameKey, color, xAxisLabel, yAxisLabel, showGrid, showTooltip
 */
export const Chart: Comp = _comp('Chart')

/**
 * LottiePlayer — plays a Lottie JSON animation.
 * src (URL), autoplay, loop, width, height
 */
export const LottiePlayer: Comp = _comp('LottiePlayer')

/**
 * HtmlContent — renders raw HTML safely.
 * html: string | () => string
 * Use extra="prose prose-sm max-w-none" for CMS/rich-text content.
 */
export const HtmlContent: Comp = _comp('HtmlContent')

/**
 * FormContainer — managed form with validation.
 * initialFormData: Record<fieldKey, defaultValue>  — every Input with matching `name` is auto-registered.
 * id: string — exposes state at variables['id-form'].
 * Submit: <Box type="submit">...</Box> inside the form.
 *
 * Form state inside FormContainer:
 *   local.form.formData.fieldName         — current value
 *   local.form.fields.fieldName.isValid   — '' = valid, string = error message
 *   local.form.isSubmitting / isSubmitted
 *
 * Form state outside FormContainer: variables['myFormId-form'].formData.fieldName
 */
export const FormContainer: Comp = _comp('FormContainer')

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

// ─── Action factories ──────────────────────────────────────────────────────────

/** local — form state accessor inside FormContainer.
 *  {local.form.fields.email.isValid !== '' && <ErrorText />} */
export const local: {
  form: {
    formData: Record<string, unknown>
    fields: Record<string, { isValid: string }>
    isSubmitting: boolean
    isSubmitted: boolean
  }
} = null as never

// ─── Workflow helpers (use inside defineWorkflow bodies only) ──────────────────

/** Set a variable inside a workflow body. In event props use set() instead.
 *  setVar(display, '0')
 *  setVar(count, count + 1) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setVar<T>(varRef: T | string, value: T): void {
  void varRef; void value
}

/** Navigate to a route.
 *  navigate('/cart')  navigate('/product', { id: item.id })  navigate(-1) */
export function navigate(path: string | number, queryParams?: Record<string, unknown>): void {
  void path; void queryParams
}

/** Fetch a datasource inside a workflow.
 *  fetch(productsDS) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fetch(datasourceRef: any): void {
  void datasourceRef
}

// ─── File type declarators ────────────────────────────────────────────────────

/** Declare a reactive variable. Type is inferred from initial value.
 *  export const x = defineVar('')      → string (global, all pages)
 *  const x = defineVar(false)          → boolean (file-scoped) */
export function defineVar<T>(initial: T): T {
  return initial
}

/** Declare a workflow. Exported = global UUID. Not exported = page-scoped.
 *  export const addToCart = defineWorkflow((id, price) => {
 *    setVar(cartCount, cartCount + 1)
 *    navigate('/cart')
 *  }) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineWorkflow<T extends (...args: any[]) => void>(fn: T): T {
  void fn; return fn
}

/** Declare a global function (formula helper).
 *  export const formatPrice = defineFunction((n) => `$${n.toFixed(2)}`)
 *  Usage in JSX: <Text>{() => formatPrice(item.price)}</Text>
 *               <Box bg={() => typeColor(item.type)}> */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineFunction<T extends (...args: any[]) => any>(fn: T): T {
  return fn
}

/** Declare a datasource (REST/GraphQL/static). Returns T[] for type-checking.
 *  export const productsDS = defineDatasource<Product>({ url: '...', method: 'GET', dataPath: 'data.items' })
 *  {productsDS.filter(p => p.active).map((p) => <Card key={p.id} />)} */
export function defineDatasource<T = unknown>(opts: {
  url:        string
  method?:    'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  dataPath?:  string
  headers?:   Record<string, string>
  body?:      Record<string, unknown>
  folder?:    string
}): T[] {
  void opts; return []
}

/** Declare a Shared Component with props schema and optional triggers.
 *  export const ProductCard = defineComponent('ProductCard', {
 *    props: { title: { type: 'string', default: '' }, price: { type: 'number', default: 0 } }
 *  }, ({ title, price }) => <Box flex col>...</Box>)
 *
 *  Triggers — let parent bind a workflow: triggers: ['onPress']
 *  In render use as bare identifier on a DOM prop: <Box onClick={onPress}>
 *  In pages: <Btn label="Go" onPress={myWorkflow} /> */
export function defineComponent(
  id: string,
  schema: {
    props?: Record<string, { type: string; default?: unknown; required?: boolean }>
    triggers?: string[]
    name?: string
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render: (props: any) => any,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  void id; void schema; return render({})
}

/** Declare a lifecycle trigger.
 *  export const onLoad = defineTrigger('pageLoad', () => { fetch(productsDS) }) */
export function defineTrigger(
  type: 'pageLoad' | 'appLoad' | 'keydown' | 'keyup' | 'scroll' | 'resize' | 'hashChange' | string,
  fn: () => void,
): void {
  void type; void fn
}

/** Declare a page. Path '/' → canonical name 'home'.
 *  export const home = definePage('/', () => ( <Box>...</Box> )) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function definePage(path: string, component: () => any): ReturnType<typeof component> {
  void path; return component()
}

// ─── Infrastructure declarators ───────────────────────────────────────────────

export type RouteOptions = { path: string; config: string; name?: string; auth?: boolean; layout?: string }
export type ThemeOptions = { brand?: string; cssVariables?: { root?: Record<string, string>; dark?: Record<string, string> } }

export function defineRoute(options: RouteOptions): RouteOptions { return options }
export function defineTheme(options: ThemeOptions): ThemeOptions { return options }
