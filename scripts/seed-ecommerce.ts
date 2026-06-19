#!/usr/bin/env npx tsx
/**
 * scripts/seed-ecommerce.ts
 *
 * Bootstraps a fully-wired e-commerce demo project:
 *   1. Register (or login) an admin user
 *   2. Create workspace + project
 *   3. Create 4 tables: products, customers, orders, order_items
 *   4. Insert sample rows via the data-plane
 *   5. Create + publish 16 CRUD API_ENDPOINT workflows
 *   6. Save a builder config with 3 pages wired to REST data sources
 *
 * Usage:
 *   cd /Users/ahmadzraiq/Desktop/json-based
 *   npx tsx scripts/seed-ecommerce.ts
 */

const BASE = 'http://localhost:4000';
const V1 = `${BASE}/v1`;

// ── Seed credentials ──────────────────────────────────────────────────────────

const SEED_EMAIL    = 'seed-ecommerce@demo.com';
const SEED_PASSWORD = 'Demo1234!';
const SEED_NAME     = 'Ecommerce Seed';

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let authCookie = '';

async function api<T = unknown>(
  path: string,
  options: RequestInit & { query?: Record<string, string> } = {},
): Promise<{ status: number; body: T; setCookie?: string }> {
  const url = path.startsWith('http') ? path : `${V1}${path}`;
  const { query, ...init } = options;
  const fullUrl = query ? `${url}?${new URLSearchParams(query)}` : url;

  const headers: Record<string, string> = {
    ...(init.body != null ? { 'Content-Type': 'application/json' } : {}),
    ...(authCookie ? { Cookie: authCookie } : {}),
    ...(init.headers as Record<string, string> | undefined ?? {}),
  };

  const res = await fetch(fullUrl, { ...init, headers });
  const text = await res.text();
  let body: T;
  try { body = JSON.parse(text) as T; } catch { body = text as unknown as T; }

  // Capture auth_token cookie
  const raw = res.headers.get('set-cookie') ?? '';
  const match = raw.match(/auth_token=([^;]+)/);
  if (match) authCookie = `auth_token=${match[1]}`;

  return { status: res.status, body, setCookie: raw || undefined };
}

function ok(label: string, status: number, expected = 201) {
  const pass = status === expected || (expected === 201 && status === 200);
  console.log(`  ${pass ? '✓' : '✗'} ${label} (${status})`);
  if (!pass) throw new Error(`Expected ${expected}, got ${status} for: ${label}`);
}

// ── Step 1: Auth ──────────────────────────────────────────────────────────────

async function authenticate(): Promise<void> {
  console.log('\n── Step 1: Auth ─────────────────────────────────────────────');
  const reg = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: SEED_NAME, email: SEED_EMAIL, password: SEED_PASSWORD }),
  });

  if (reg.status === 409) {
    // Already exists — login
    const login = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
    });
    ok('Login existing seed user', login.status, 200);
  } else {
    ok('Register seed user', reg.status);
  }
  console.log(`  Cookie: ${authCookie.slice(0, 40)}…`);
}

// ── Step 2: Workspace + Project ───────────────────────────────────────────────

async function createProject(): Promise<{ workspaceId: string; projectId: string }> {
  console.log('\n── Step 2: Workspace + Project ──────────────────────────────');

  const ws = await api<{ workspace: { id: string } }>('/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name: 'E-commerce Demo' }),
  });
  ok('Create workspace', ws.status);
  const workspaceId = ws.body.workspace.id;
  console.log(`  Workspace ID: ${workspaceId}`);

  const proj = await api<{ project: { id: string } }>(`/workspaces/${workspaceId}/projects`, {
    method: 'POST',
    body: JSON.stringify({ name: 'My Store' }),
  });
  ok('Create project', proj.status);
  const projectId = proj.body.project.id;
  console.log(`  Project ID:   ${projectId}`);

  return { workspaceId, projectId };
}

// ── Step 3: Tables ────────────────────────────────────────────────────────────

const TABLE_DEFS = [
  {
    name: 'products',
    displayName: 'Products',
    columns: [
      { name: 'name',        type: 'TEXT',    nullable: false },
      { name: 'description', type: 'TEXT',    nullable: true  },
      { name: 'price',       type: 'DECIMAL', nullable: false },
      { name: 'stock',       type: 'INT',     nullable: false },
      { name: 'category',    type: 'TEXT',    nullable: true  },
      { name: 'active',      type: 'BOOL',    nullable: false, defaultVal: 'true' },
    ],
  },
  {
    name: 'customers',
    displayName: 'Customers',
    columns: [
      { name: 'name',  type: 'TEXT', nullable: false },
      { name: 'email', type: 'TEXT', nullable: false },
      { name: 'phone', type: 'TEXT', nullable: true  },
      { name: 'city',  type: 'TEXT', nullable: true  },
    ],
  },
  {
    name: 'orders',
    displayName: 'Orders',
    columns: [
      { name: 'customer_id', type: 'TEXT',    nullable: false },
      { name: 'status',      type: 'TEXT',    nullable: false, defaultVal: "'pending'" },
      { name: 'total',       type: 'DECIMAL', nullable: false },
      { name: 'notes',       type: 'TEXT',    nullable: true  },
    ],
  },
  {
    name: 'order_items',
    displayName: 'Order Items',
    columns: [
      { name: 'order_id',   type: 'TEXT',    nullable: false },
      { name: 'product_id', type: 'TEXT',    nullable: false },
      { name: 'quantity',   type: 'INT',     nullable: false },
      { name: 'unit_price', type: 'DECIMAL', nullable: false },
    ],
  },
] as const;

async function createTables(projectId: string): Promise<Record<string, string>> {
  console.log('\n── Step 3: Tables ───────────────────────────────────────────');
  const tableIds: Record<string, string> = {};

  for (const def of TABLE_DEFS) {
    const res = await api<{ table: { id: string } }>(
      `/projects/${projectId}/tables`,
      {
        method: 'POST',
        body: JSON.stringify({
          name:             def.name,
          displayName:      def.displayName,
          createApiActions: false,
          columns:          def.columns,
        }),
      },
    );
    ok(`Create table: ${def.name}`, res.status);
    tableIds[def.name] = res.body.table.id;
  }

  return tableIds;
}

// ── Step 4: Sample Data ───────────────────────────────────────────────────────

async function insertSampleData(projectId: string): Promise<{
  productIds: string[];
  customerIds: string[];
  orderIds: string[];
}> {
  console.log('\n── Step 4: Sample Data ──────────────────────────────────────');

  // Helper — insert one row and return its id
  // Data-plane POST returns { data: row }
  async function insertRow(
    table: string,
    data: Record<string, unknown>,
  ): Promise<string> {
    const res = await api<{ data: { id: string } }>(`/data/${projectId}/${table}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (res.status !== 201 && res.status !== 200) {
      throw new Error(`Insert into ${table} failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.data.id;
  }

  // Brief pause after tables creation before inserting data
  await sleep(200);

  // Products
  const products = [
    { name: 'Classic T-Shirt',   description: 'Comfortable cotton tee',        price: 19.99, stock: 150, category: 'Apparel',     active: true },
    { name: 'Laptop Pro 15"',    description: '16GB RAM, 512GB SSD',            price: 1299,  stock: 12,  category: 'Electronics', active: true },
    { name: 'Coffee Mug',        description: 'Ceramic 12oz mug',               price: 9.99,  stock: 200, category: 'Kitchen',     active: true },
    { name: 'Running Sneakers',  description: 'Lightweight trail runners',      price: 89.95, stock: 45,  category: 'Footwear',    active: true },
    { name: 'Desk Lamp',         description: 'LED adjustable arm lamp',        price: 34.99, stock: 60,  category: 'Office',      active: true },
    { name: 'Notebook A5',       description: 'Hardcover dotted 192 pages',     price: 14.99, stock: 300, category: 'Stationery',  active: true },
    { name: 'Wireless Headphones', description: 'Bluetooth noise-cancelling',   price: 199,   stock: 30,  category: 'Electronics', active: true },
    { name: 'Water Bottle 1L',   description: 'Insulated stainless steel',      price: 24.99, stock: 80,  category: 'Sports',      active: false },
  ];
  const productIds: string[] = [];
  for (const p of products) {
    productIds.push(await insertRow('products', p));
  }
  console.log(`  ✓ Inserted ${productIds.length} products`);

  // Customers
  const customers = [
    { name: 'Alice Johnson',  email: 'alice@example.com',   phone: '+1-555-0101', city: 'New York' },
    { name: 'Bob Martinez',   email: 'bob@example.com',     phone: '+1-555-0102', city: 'Los Angeles' },
    { name: 'Carol Lee',      email: 'carol@example.com',   phone: '+1-555-0103', city: 'Chicago' },
    { name: 'David Kim',      email: 'david@example.com',   phone: '+1-555-0104', city: 'Houston' },
    { name: 'Eva Müller',     email: 'eva@example.com',     phone: '+49-30-5550', city: 'Berlin' },
  ];
  const customerIds: string[] = [];
  for (const c of customers) {
    customerIds.push(await insertRow('customers', c));
  }
  console.log(`  ✓ Inserted ${customerIds.length} customers`);

  // Orders
  const orderDefs = [
    { customer_id: customerIds[0], status: 'delivered',  total: 1319,   notes: 'Gift wrap requested' },
    { customer_id: customerIds[1], status: 'shipped',    total: 89.95,  notes: null },
    { customer_id: customerIds[2], status: 'pending',    total: 44.98,  notes: 'Leave at door' },
    { customer_id: customerIds[3], status: 'processing', total: 224.99, notes: null },
    { customer_id: customerIds[4], status: 'cancelled',  total: 9.99,   notes: 'Customer requested cancel' },
  ];
  const orderIds: string[] = [];
  for (const o of orderDefs) {
    orderIds.push(await insertRow('orders', o));
  }
  console.log(`  ✓ Inserted ${orderIds.length} orders`);

  // Order items
  const items = [
    { order_id: orderIds[0], product_id: productIds[1], quantity: 1, unit_price: 1299   },
    { order_id: orderIds[0], product_id: productIds[0], quantity: 1, unit_price: 19.99  },
    { order_id: orderIds[1], product_id: productIds[3], quantity: 1, unit_price: 89.95  },
    { order_id: orderIds[2], product_id: productIds[2], quantity: 2, unit_price: 9.99   },
    { order_id: orderIds[2], product_id: productIds[5], quantity: 1, unit_price: 14.99  },
    { order_id: orderIds[2], product_id: productIds[2], quantity: 1, unit_price: 9.99   },
    { order_id: orderIds[3], product_id: productIds[6], quantity: 1, unit_price: 199    },
    { order_id: orderIds[3], product_id: productIds[4], quantity: 1, unit_price: 34.99  },
    { order_id: orderIds[4], product_id: productIds[2], quantity: 1, unit_price: 9.99   },
    { order_id: orderIds[0], product_id: productIds[0], quantity: 2, unit_price: 19.99  },
  ];
  for (const item of items) {
    await insertRow('order_items', item);
  }
  console.log(`  ✓ Inserted ${items.length} order items`);

  return { productIds, customerIds, orderIds };
}

// ── Step 5: CRUD Workflows ────────────────────────────────────────────────────

type ActionStep = Record<string, unknown>;

function makeListSteps(table: string): ActionStep[] {
  return [
    { id: 's1', type: 'tablesList', config: { table, filters: [], sort: [], page: 1, pageSize: 100 } },
    { id: 's2', type: 'sendResponse', config: { status: '200', body: '$var.__step_s1', bodyType: 'JSON' } },
  ];
}

function makeInsertSteps(table: string): ActionStep[] {
  return [
    { id: 's1', type: 'tablesInsert', config: { table, data: '$input' } },
    { id: 's2', type: 'sendResponse', config: { status: '201', body: '$var.__step_s1', bodyType: 'JSON' } },
  ];
}

function makeUpdateSteps(table: string): ActionStep[] {
  return [
    { id: 's1', type: 'tablesUpdate', config: { table, rowId: '$input.id', data: '$input' } },
    { id: 's2', type: 'sendResponse', config: { status: '200', body: '$var.__step_s1', bodyType: 'JSON' } },
  ];
}

function makeDeleteSteps(table: string): ActionStep[] {
  return [
    { id: 's1', type: 'tablesDelete', config: { table, rowId: '$input.id' } },
    { id: 's2', type: 'sendResponse', config: { status: '200', body: { ok: true }, bodyType: 'JSON' } },
  ];
}

async function createWorkflows(projectId: string): Promise<Record<string, string>> {
  console.log('\n── Step 5: CRUD Workflows ───────────────────────────────────');

  const tables = ['products', 'customers', 'orders', 'order_items'];
  const slugMap: Record<string, string> = {};

  const ops: Array<{
    table: string;
    slug: string;
    name: string;
    method: string;
    steps: ActionStep[];
    folder: string;
  }> = [];

  for (const table of tables) {
    const folder = table.replace(/_/g, '-');
    ops.push(
      { table, folder, slug: `${folder}-list`,   name: `List ${table}`,   method: 'GET',    steps: makeListSteps(table) },
      { table, folder, slug: `${folder}-create`, name: `Create ${table}`, method: 'POST',   steps: makeInsertSteps(table) },
      { table, folder, slug: `${folder}-update`, name: `Update ${table}`, method: 'PUT',    steps: makeUpdateSteps(table) },
      { table, folder, slug: `${folder}-delete`, name: `Delete ${table}`, method: 'DELETE', steps: makeDeleteSteps(table) },
    );
  }

  for (const op of ops) {
    // Create
    const create = await api<{ workflow: { id: string } }>(
      `/projects/${projectId}/workflows`,
      {
        method: 'POST',
        body: JSON.stringify({
          name:         op.name,
          slug:         op.slug,
          kind:         'API_ENDPOINT',
          method:       op.method,
          path:         `/${op.slug}`,
          folder:       op.folder,
          security:     'PUBLIC',
          allowedRoles: [],
          graph:        op.steps,
        }),
      },
    );

    if (create.status !== 201) {
      console.log(`  ⚠ Skipping ${op.slug} (${create.status})`);
      await sleep(400);
      continue;
    }

    const wfId = create.body.workflow.id;
    slugMap[op.slug] = wfId;

    // Small pause to stay well under the 100 req/min rate limit
    await sleep(120);

    // Publish
    const pub = await api(`/projects/${projectId}/workflows/${wfId}/publish`, { method: 'POST' });
    if (pub.status !== 200) {
      console.log(`    publish body: ${JSON.stringify(pub.body)}`);
    }
    ok(`${op.method.padEnd(6)} ${op.slug}`, pub.status, 200);
    await sleep(120);
  }

  return slugMap;
}

// ── Step 6: Builder Config ────────────────────────────────────────────────────

function uid(): string {
  return crypto.randomUUID();
}

// SDUINode helpers — only Box and Text are valid node types in the engine.
// Repeat loops use a `map` field on Box (not a ForEach type).
// Template references inside map nodes use {{context.item.<field>}}.

function text(
  content: string,
  className = '',
): Record<string, unknown> {
  return { id: uid(), type: 'Text', text: content, props: { className } };
}

function box(
  children: unknown[],
  opts: { className?: string; map?: string; name?: string } = {},
): Record<string, unknown> {
  return {
    id: uid(), type: 'Box',
    ...(opts.name  ? { name: opts.name }  : {}),
    ...(opts.map   ? { map: opts.map }    : {}),
    props: { className: opts.className ?? '' },
    children,
  };
}

/**
 * Build the full builder config blob with 3 pages + data sources.
 * Uses serializeBuilderState shape so the builder can load it correctly.
 */
function buildBuilderConfig(projectId: string): Record<string, unknown> {
  const API_BASE = `http://localhost:4000/v1/run/${projectId}`;

  // ── Data sources ─────────────────────────────────────────────────────────
  // storeIn = ds.id so the collections key equals the UUID.
  // map references: collections.<dsId> = full response { data: [...], count: N }
  // so we use collections.<dsId>.data as the array path.
  const dsProductsId  = uid();
  const dsCustomersId = uid();
  const dsOrdersId    = uid();

  const pageDataSources = [
    {
      id: dsProductsId,  name: 'Products List',  type: 'rest',
      url: `${API_BASE}/products-list`,
      method: 'GET',
      storeIn: dsProductsId,
      trigger: 'mount',
      sendCredentials: false,
    },
    {
      id: dsCustomersId, name: 'Customers List', type: 'rest',
      url: `${API_BASE}/customers-list`,
      method: 'GET',
      storeIn: dsCustomersId,
      trigger: 'mount',
      sendCredentials: false,
    },
    {
      id: dsOrdersId,    name: 'Orders List',    type: 'rest',
      url: `${API_BASE}/orders-list`,
      method: 'GET',
      storeIn: dsOrdersId,
      trigger: 'mount',
      sendCredentials: false,
    },
  ];

  // ── Products page nodes ──────────────────────────────────────────────────
  // Outer Box wraps the page; inner Box with `map` repeats per product row.
  const productsRoot = box([
    box([
      text('Products', 'text-2xl font-bold text-slate-900 mb-4'),
    ], { name: 'Header', className: 'flex items-center justify-between mb-6' }),
    box([
      box([
        text('{{context.item.name}}',     'font-semibold text-slate-900'),
        text('{{context.item.category}}', 'text-xs text-slate-500'),
      ], { name: 'ProductCardInner', className: 'flex flex-col gap-1' }),
      box([
        text('${{context.item.price}}',        'font-bold text-lg text-slate-900'),
        text('{{context.item.stock}} in stock', 'text-xs text-slate-500'),
      ], { className: 'flex items-center gap-3 mt-2' }),
    ], {
      name: 'ProductCard',
      map: `collections.${dsProductsId}.data`,
      className: 'rounded-lg border border-slate-200 bg-white p-4 shadow-sm flex flex-col gap-1',
    }),
  ], { name: 'ProductsPage', className: 'flex flex-col gap-4 p-6' });

  // ── Customers page nodes ─────────────────────────────────────────────────
  const customersRoot = box([
    box([
      text('Customers', 'text-2xl font-bold text-slate-900'),
    ], { name: 'Header', className: 'mb-6' }),
    box([
      box([
        text('{{context.item.name}}',  'font-semibold text-slate-900'),
        text('{{context.item.city}}',  'text-sm text-slate-500'),
        text('{{context.item.email}}', 'text-sm text-blue-600'),
      ], {
        name: 'CustomerRow',
        map: `collections.${dsCustomersId}.data`,
        className: 'rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-1',
      }),
    ], { className: 'flex flex-col gap-3' }),
  ], { name: 'CustomersPage', className: 'flex flex-col p-6' });

  // ── Orders page nodes ────────────────────────────────────────────────────
  const ordersRoot = box([
    box([
      text('Orders', 'text-2xl font-bold text-slate-900'),
    ], { name: 'Header', className: 'mb-6' }),
    box([
      box([
        box([
          text('Order #{{context.item.id}}', 'font-semibold text-slate-900 text-sm'),
          text('{{context.item.status}}',    'text-xs font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-600'),
        ], { className: 'flex items-center justify-between' }),
        box([
          text('Total: ${{context.item.total}}', 'font-bold text-slate-900'),
          text('{{context.item.notes}}',          'text-xs text-slate-400'),
        ], { className: 'flex items-center gap-4 mt-1' }),
      ], {
        name: 'OrderRow',
        map: `collections.${dsOrdersId}.data`,
        className: 'rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-2',
      }),
    ], { className: 'flex flex-col gap-3' }),
  ], { name: 'OrdersPage', className: 'flex flex-col p-6' });

  // ── Pages — BuilderPage shape ─────────────────────────────────────────────
  const pages = [
    { id: 'page-products',  name: 'Products',  route: '/products',  nodes: [productsRoot],  queryParams: [], wx: 0,    wy: 0 },
    { id: 'page-customers', name: 'Customers', route: '/customers', nodes: [customersRoot], queryParams: [], wx: 1200, wy: 0 },
    { id: 'page-orders',    name: 'Orders',    route: '/orders',    nodes: [ordersRoot],    queryParams: [], wx: 2400, wy: 0 },
  ];

  // serializeBuilderState shape
  return {
    pages,
    pageDataSources,
    workflows:          {},
    customVars:         [],
    varFolders:         [],
    dsFolders:          [],
    customColors:       [],
    colorFolders:       [],
    themeOverrides:     {},
    themeDarkOverrides: {},
    sharedComponents:   {},
  };
}

async function saveBuilderConfig(projectId: string): Promise<void> {
  console.log('\n── Step 6: Builder Config ───────────────────────────────────');
  const config = buildBuilderConfig(projectId);

  // Use the frontend proxy so cookies/auth flow correctly
  const res = await api(`/projects/${projectId}/config`, {
    method: 'PATCH',
    body: JSON.stringify(config),
  });
  ok('Save builder config', res.status, 200);
  console.log('  Pages: Products, Customers, Orders');
  console.log('  Data sources: 3 REST sources (products-list, customers-list, orders-list)');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   E-commerce Demo Seed Script                ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`Backend: ${BASE}`);

  await authenticate();
  const { projectId } = await createProject();
  await createTables(projectId);
  await insertSampleData(projectId);
  await createWorkflows(projectId);
  await saveBuilderConfig(projectId);

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   Done!                                       ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`
  Project:  My Store
  ID:       ${projectId}

  Builder:  http://localhost:3001/builder/${projectId}
  API base: ${BASE}/v1/run/${projectId}/

  Tables:   products (8 rows)
            customers (5 rows)
            orders (5 rows)
            order_items (10 rows)

  Workflows: 16 published API endpoints
             products-list / -create / -update / -delete
             customers-list / -create / -update / -delete
             orders-list / -create / -update / -delete
             order-items-list / -create / -update / -delete

  Pages:    /products  → REST datasource → products-list
            /customers → REST datasource → customers-list
            /orders    → REST datasource → orders-list

  Open the builder URL above to see the pre-wired UI.
`);
}

main().catch(err => {
  console.error('\n✗ Seed failed:', err.message ?? err);
  process.exit(1);
});
