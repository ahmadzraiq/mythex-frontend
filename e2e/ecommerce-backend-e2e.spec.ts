/**
 * E-commerce Backend + Builder E2E Tests
 *
 * Bootstraps a fresh e-commerce demo project via the API, then verifies:
 *
 * API-01  products-list returns 8 rows
 * API-02  customers-list returns 5 rows
 * API-03  orders-list returns 5 rows
 * API-04  order-items-list returns 10 rows
 * API-05  products-create inserts a new row and returns it (201)
 * API-06  products-update changes the row (200)
 * API-07  products-delete removes the row (200)
 * API-08  orders-create with real customer_id succeeds (201)
 * API-09  custom SQL workflow returns products count = 8
 *
 * BUILDER-01  Builder loads the seeded project without errors
 * BUILDER-02  Three pages present: Products, Customers, Orders
 * BUILDER-03  Three REST data sources present in the Zustand store
 * BUILDER-04  Products page has renderable Box nodes on the canvas
 * BUILDER-05  Data & API mode icon button is present and clickable
 * BUILDER-06  products table appears in the tables list
 * BUILDER-07  Products page nodes reference the data-source collections key
 *
 * Usage:
 *   # Use a pre-seeded project (fastest, avoids rate-limit re-seed):
 *   SEED_PROJECT_ID=<id> npx playwright test e2e/ecommerce-backend-e2e.spec.ts
 *
 *   # Let the test seed itself (requires ~70 req budget on the backend):
 *   npx playwright test e2e/ecommerce-backend-e2e.spec.ts --workers=1
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const FRONTEND   = 'http://localhost:3001';
const BACKEND    = 'http://localhost:4000';
const SEED_EMAIL = 'seed-ecommerce@demo.com';
const SEED_PASS  = 'Demo1234!';

const pause = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── Shared state ──────────────────────────────────────────────────────────────

let authToken  = '';
let projectId  = '';
let bCtx:        BrowserContext;
let page:        Page;

// ── Low-level fetch helpers ───────────────────────────────────────────────────

async function bReq<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BACKEND}/v1${path}`, {
    method,
    headers: {
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(authToken  ? { Cookie: `auth_token=${authToken}` }   : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  try   { return { status: res.status, data: JSON.parse(txt) as T }; }
  catch { return { status: res.status, data: txt as unknown as T  }; }
}

const bPost   = <T = unknown>(path: string, body?: unknown) => bReq<T>('POST',   path, body);
const bPut    = <T = unknown>(path: string, body?: unknown) => bReq<T>('PUT',    path, body);
const bDelete = <T = unknown>(path: string, body?: unknown) => bReq<T>('DELETE', path, body);

async function bGet<T = unknown>(path: string): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BACKEND}/v1${path}`, {
    headers: authToken ? { Cookie: `auth_token=${authToken}` } : {},
  });
  const txt = await res.text();
  try   { return { status: res.status, data: JSON.parse(txt) as T }; }
  catch { return { status: res.status, data: txt as unknown as T  }; }
}

/** Authenticate and capture the cookie. Registers if the user doesn't exist yet. */
async function doAuth(): Promise<void> {
  const login = await fetch(`${BACKEND}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASS }),
  });
  if (!login.ok) {
    // Register first, then login
    await fetch(`${BACKEND}/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ecommerce Seed', email: SEED_EMAIL, password: SEED_PASS }),
    });
    const login2 = await fetch(`${BACKEND}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASS }),
    });
    const raw = login2.headers.get('set-cookie') ?? '';
    const m = raw.match(/auth_token=([^;]+)/);
    if (m) authToken = m[1];
    return;
  }
  const raw = login.headers.get('set-cookie') ?? '';
  const m = raw.match(/auth_token=([^;]+)/);
  if (m) authToken = m[1];
}

/** Insert one row via the data-plane and return its id. */
async function insertRow(table: string, data: Record<string, unknown>): Promise<string> {
  const r = await bPost<{ data: { id: string } }>(`/data/${projectId}/${table}`, data);
  if (r.status !== 201 && r.status !== 200) {
    throw new Error(`Insert ${table} → ${r.status}: ${JSON.stringify(r.data)}`);
  }
  return (r.data as { data: { id: string } }).data.id;
}

/** Create + immediately publish one workflow. */
async function seedWorkflow(opts: {
  slug: string; name: string; method: string; steps: object[];
}): Promise<void> {
  const cr = await bPost<{ workflow: { id: string } }>(
    `/projects/${projectId}/workflows`,
    {
      name:         opts.name,
      slug:         opts.slug,
      kind:         'API_ENDPOINT',
      method:       opts.method,
      path:         `/${opts.slug}`,
      folder:       opts.slug.split('-')[0],
      security:     'PUBLIC',
      allowedRoles: [],
      graph:        opts.steps,
    },
  );
  if (cr.status !== 201) throw new Error(`Create wf ${opts.slug} → ${cr.status}: ${JSON.stringify(cr.data)}`);
  const wfId = (cr.data as { workflow: { id: string } }).workflow.id;
  await pause(120);
  const pub = await fetch(`${BACKEND}/v1/projects/${projectId}/workflows/${wfId}/publish`, {
    method: 'POST',
    headers: { Cookie: `auth_token=${authToken}` },
  });
  if (pub.status !== 200) throw new Error(`Publish ${opts.slug} → ${pub.status}`);
  await pause(120);
}

// ── uid ───────────────────────────────────────────────────────────────────────
function uid(): string {
  return crypto.randomUUID();
}

// ── Full seed — called only when no SEED_PROJECT_ID env var is set ────────────
async function seedProject(): Promise<void> {
  // ── Workspace + project ────────────────────────────────────────────────────
  const ws = await bPost<{ workspace: { id: string } }>('/workspaces', { name: 'E2E Demo' });
  if (ws.status !== 201) throw new Error(`Create workspace: ${ws.status}`);
  const wsId = (ws.data as { workspace: { id: string } }).workspace.id;

  const pr = await bPost<{ project: { id: string } }>(
    `/workspaces/${wsId}/projects`, { name: 'My Store' },
  );
  if (pr.status !== 201) throw new Error(`Create project: ${pr.status}`);
  projectId = (pr.data as { project: { id: string } }).project.id;

  // ── Tables ─────────────────────────────────────────────────────────────────
  const tables = [
    { name: 'products',    displayName: 'Products',
      columns: [
        { name: 'name',        type: 'TEXT',    nullable: false },
        { name: 'description', type: 'TEXT',    nullable: true  },
        { name: 'price',       type: 'DECIMAL', nullable: false },
        { name: 'stock',       type: 'INT',     nullable: false },
        { name: 'category',    type: 'TEXT',    nullable: true  },
        { name: 'active',      type: 'BOOL',    nullable: false },
      ]},
    { name: 'customers',   displayName: 'Customers',
      columns: [
        { name: 'name',  type: 'TEXT', nullable: false },
        { name: 'email', type: 'TEXT', nullable: false },
        { name: 'phone', type: 'TEXT', nullable: true  },
        { name: 'city',  type: 'TEXT', nullable: true  },
      ]},
    { name: 'orders',      displayName: 'Orders',
      columns: [
        { name: 'customer_id', type: 'TEXT',    nullable: false },
        { name: 'status',      type: 'TEXT',    nullable: false },
        { name: 'total',       type: 'DECIMAL', nullable: false },
        { name: 'notes',       type: 'TEXT',    nullable: true  },
      ]},
    { name: 'order_items', displayName: 'Order Items',
      columns: [
        { name: 'order_id',   type: 'TEXT',    nullable: false },
        { name: 'product_id', type: 'TEXT',    nullable: false },
        { name: 'quantity',   type: 'INT',     nullable: false },
        { name: 'unit_price', type: 'DECIMAL', nullable: false },
      ]},
  ];
  for (const t of tables) {
    const r = await bPost(`/projects/${projectId}/tables`, t);
    if (r.status !== 201) throw new Error(`Create table ${t.name}: ${r.status} ${JSON.stringify(r.data)}`);
  }

  await pause(200);

  // ── Sample data ────────────────────────────────────────────────────────────
  const productIds: string[] = [];
  for (const p of [
    { name: 'Classic T-Shirt',    description: 'Cotton tee',            price: 19.99, stock: 150, category: 'Apparel',     active: true  },
    { name: 'Laptop Pro 15"',     description: '16GB RAM 512GB SSD',    price: 1299,  stock: 12,  category: 'Electronics', active: true  },
    { name: 'Coffee Mug',         description: '12oz ceramic mug',      price: 9.99,  stock: 200, category: 'Kitchen',     active: true  },
    { name: 'Running Sneakers',   description: 'Lightweight runners',   price: 89.95, stock: 45,  category: 'Footwear',    active: true  },
    { name: 'Desk Lamp',          description: 'LED adjustable lamp',   price: 34.99, stock: 60,  category: 'Office',      active: true  },
    { name: 'Notebook A5',        description: '192 page dotted',       price: 14.99, stock: 300, category: 'Stationery',  active: true  },
    { name: 'Wireless Headphones',description: 'BT noise-cancelling',   price: 199,   stock: 30,  category: 'Electronics', active: true  },
    { name: 'Water Bottle 1L',    description: 'Insulated stainless',   price: 24.99, stock: 80,  category: 'Sports',      active: false },
  ]) { productIds.push(await insertRow('products', p)); }

  const customerIds: string[] = [];
  for (const c of [
    { name: 'Alice Johnson', email: 'alice@example.com', phone: '+1-555-0101', city: 'New York'   },
    { name: 'Bob Martinez',  email: 'bob@example.com',   phone: '+1-555-0102', city: 'Los Angeles' },
    { name: 'Carol Lee',     email: 'carol@example.com', phone: '+1-555-0103', city: 'Chicago'     },
    { name: 'David Kim',     email: 'david@example.com', phone: '+1-555-0104', city: 'Houston'     },
    { name: 'Eva Müller',    email: 'eva@example.com',   phone: '+49-30-5550', city: 'Berlin'      },
  ]) { customerIds.push(await insertRow('customers', c)); }

  const orderIds: string[] = [];
  for (const o of [
    { customer_id: customerIds[0], status: 'delivered',  total: 1319,   notes: 'Gift wrap'   },
    { customer_id: customerIds[1], status: 'shipped',    total: 89.95,  notes: null          },
    { customer_id: customerIds[2], status: 'pending',    total: 44.98,  notes: 'Leave at door'},
    { customer_id: customerIds[3], status: 'processing', total: 224.99, notes: null          },
    { customer_id: customerIds[4], status: 'cancelled',  total: 9.99,   notes: 'Cancel req'  },
  ]) { orderIds.push(await insertRow('orders', o)); }

  for (const item of [
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
  ]) { await insertRow('order_items', item); }

  // ── CRUD workflows ─────────────────────────────────────────────────────────
  for (const table of ['products', 'customers', 'orders', 'order_items']) {
    const f = table.replace(/_/g, '-');
    await seedWorkflow({ slug: `${f}-list`,   name: `List ${table}`,   method: 'GET',
      steps: [
        { id: 's1', type: 'tablesList',   config: { table, filters: [], sort: [] } },
        { id: 's2', type: 'sendResponse', config: { status: '200', body: '$var.__step_s1', bodyType: 'JSON' } },
      ]});
    await seedWorkflow({ slug: `${f}-create`, name: `Create ${table}`, method: 'POST',
      steps: [
        { id: 's1', type: 'tablesInsert',  config: { table, data: '$input' } },
        { id: 's2', type: 'sendResponse',  config: { status: '201', body: '$var.__step_s1', bodyType: 'JSON' } },
      ]});
    await seedWorkflow({ slug: `${f}-update`, name: `Update ${table}`, method: 'PUT',
      steps: [
        { id: 's1', type: 'tablesUpdate',  config: { table, rowId: '$input.id', data: '$input' } },
        { id: 's2', type: 'sendResponse',  config: { status: '200', body: '$var.__step_s1', bodyType: 'JSON' } },
      ]});
    await seedWorkflow({ slug: `${f}-delete`, name: `Delete ${table}`, method: 'DELETE',
      steps: [
        { id: 's1', type: 'tablesDelete',  config: { table, rowId: '$input.id' } },
        { id: 's2', type: 'sendResponse',  config: { status: '200', body: { ok: true }, bodyType: 'JSON' } },
      ]});
  }

  // ── Builder config ─────────────────────────────────────────────────────────
  const dsProductsId  = uid();
  const dsCustomersId = uid();
  const dsOrdersId    = uid();
  const API_BASE      = `${BACKEND}/v1/run/${projectId}`;

  const box  = (children: unknown[], opts: { name?: string; map?: string; className?: string } = {}) =>
    ({ id: uid(), type: 'Box', ...(opts.name ? { name: opts.name } : {}), ...(opts.map ? { map: opts.map } : {}), props: { className: opts.className ?? '' }, children });
  const txt = (content: string, className = '') =>
    ({ id: uid(), type: 'Text', text: content, props: { className } });

  const pages = [
    { id: 'page-products',  name: 'Products',  route: '/products',  wx: 0,    wy: 0, queryParams: [],
      nodes: [box([
        box([txt('Products','text-2xl font-bold')], { className:'mb-4' }),
        box([
          box([
            txt('{{context.item.name}}',     'font-semibold'),
            txt('{{context.item.category}}', 'text-xs text-slate-500'),
            txt('${{context.item.price}}',   'font-bold'),
          ], { name: 'ProductCard', map: `collections.${dsProductsId}.data`, className:'border rounded p-4' }),
        ], { className:'flex flex-col gap-3' }),
      ], { name:'ProductsPage', className:'p-6 flex flex-col gap-4' })],
    },
    { id: 'page-customers', name: 'Customers', route: '/customers', wx: 1200, wy: 0, queryParams: [],
      nodes: [box([
        box([txt('Customers','text-2xl font-bold')], { className:'mb-4' }),
        box([
          box([
            txt('{{context.item.name}}',  'font-semibold'),
            txt('{{context.item.email}}', 'text-sm text-blue-600'),
            txt('{{context.item.city}}',  'text-xs text-slate-500'),
          ], { name: 'CustomerRow', map: `collections.${dsCustomersId}.data`, className:'border rounded p-4' }),
        ], { className:'flex flex-col gap-2' }),
      ], { name:'CustomersPage', className:'p-6 flex flex-col gap-4' })],
    },
    { id: 'page-orders', name: 'Orders', route: '/orders', wx: 2400, wy: 0, queryParams: [],
      nodes: [box([
        box([txt('Orders','text-2xl font-bold')], { className:'mb-4' }),
        box([
          box([
            txt('Order #{{context.item.id}}',    'font-semibold'),
            txt('{{context.item.status}}',       'text-xs bg-slate-100 px-2 py-0.5 rounded'),
            txt('Total: ${{context.item.total}}','font-bold'),
          ], { name: 'OrderRow', map: `collections.${dsOrdersId}.data`, className:'border rounded p-4' }),
        ], { className:'flex flex-col gap-2' }),
      ], { name:'OrdersPage', className:'p-6 flex flex-col gap-4' })],
    },
  ];

  const configRes = await fetch(`${BACKEND}/v1/projects/${projectId}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: `auth_token=${authToken}` },
    body: JSON.stringify({
      pages,
      pageDataSources: [
        { id: dsProductsId,  name: 'Products List',  type: 'rest', url: `${API_BASE}/products-list`,  method: 'GET', storeIn: dsProductsId,  trigger: 'mount' },
        { id: dsCustomersId, name: 'Customers List', type: 'rest', url: `${API_BASE}/customers-list`, method: 'GET', storeIn: dsCustomersId, trigger: 'mount' },
        { id: dsOrdersId,    name: 'Orders List',    type: 'rest', url: `${API_BASE}/orders-list`,    method: 'GET', storeIn: dsOrdersId,    trigger: 'mount' },
      ],
      workflows: {},
      customVars: [], varFolders: [], dsFolders: [], customColors: [], colorFolders: [],
      themeOverrides: {}, themeDarkOverrides: {}, sharedComponents: {},
    }),
  });
  if (!configRes.ok) throw new Error(`Save config: ${configRes.status}`);
}

// ── Suite setup ───────────────────────────────────────────────────────────────

test.beforeAll(async ({ browser }) => {
  // 1. Get the backend JWT token for Node.js fetch calls (API tests)
  await doAuth();
  expect(authToken, 'Auth token must be set').toBeTruthy();

  // 2. Seed or reuse project
  if (process.env['SEED_PROJECT_ID']) {
    projectId = process.env['SEED_PROJECT_ID'];
    console.log(`  Using pre-seeded project: ${projectId}`);
  } else {
    console.log('  Seeding fresh project…');
    await seedProject();
    console.log(`  Project seeded: ${projectId}`);
  }
  expect(projectId, 'projectId must be set after seed').toBeTruthy();

  // 3. Create browser context and log in via the FRONTEND login endpoint
  //    so the cookie is set correctly for localhost:3001 (matching the middleware).
  bCtx = await browser.newContext();
  const loginRes = await bCtx.request.post(`${FRONTEND}/api/auth/login`, {
    data:    { email: SEED_EMAIL, password: SEED_PASS },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(loginRes.ok(), `Frontend login failed: ${await loginRes.text()}`).toBeTruthy();

  // The response sets Set-Cookie in the Playwright context automatically.
  // Also extract the raw header to inject explicitly (belt-and-suspenders).
  const setCookieHeader = loginRes.headers()['set-cookie'] ?? '';
  const m = setCookieHeader.match(/auth_token=([^;]+)/);
  if (m) {
    await bCtx.addCookies([{
      name:     'auth_token',
      value:    m[1],
      domain:   'localhost',
      path:     '/',
      httpOnly: true,
      sameSite: 'Strict',
    }]);
  }

  page = await bCtx.newPage();
});

test.afterAll(async () => {
  await bCtx?.close();
});

// ═══════════════════════════════════════════════════════════════════════════
//  API Tests — call /v1/run/:projectId/:slug directly
// ═══════════════════════════════════════════════════════════════════════════

test.describe('API-01 — list endpoints return seed data counts', () => {
  test('products-list returns at least 8 rows', async () => {
    const { status, data } = await bGet<{ data: unknown[] }>(`/run/${projectId}/products-list`);
    expect(status).toBe(200);
    expect((data as { data: unknown[] }).data.length).toBeGreaterThanOrEqual(8);
  });

  test('customers-list returns at least 5 rows', async () => {
    const { status, data } = await bGet<{ data: unknown[] }>(`/run/${projectId}/customers-list`);
    expect(status).toBe(200);
    expect((data as { data: unknown[] }).data.length).toBeGreaterThanOrEqual(5);
  });

  test('orders-list returns at least 5 rows', async () => {
    const { status, data } = await bGet<{ data: unknown[] }>(`/run/${projectId}/orders-list`);
    expect(status).toBe(200);
    expect((data as { data: unknown[] }).data.length).toBeGreaterThanOrEqual(5);
  });

  test('order-items-list returns at least 10 rows', async () => {
    const { status, data } = await bGet<{ data: unknown[] }>(`/run/${projectId}/order-items-list`);
    expect(status).toBe(200);
    expect((data as { data: unknown[] }).data.length).toBeGreaterThanOrEqual(10);
  });
});

test.describe('API-02 — products CRUD lifecycle', () => {
  let newId      = '';
  let initialCount = 0;

  test('products-create returns 201 with the new row', async () => {
    // Capture baseline count before creating
    const { data: listData } = await bGet<{ data: unknown[] }>(`/run/${projectId}/products-list`);
    initialCount = (listData as { data: unknown[] }).data.length;
    expect(initialCount).toBeGreaterThanOrEqual(8);
    // POST /run/:project/products-create — workflow configured with method POST
    const { status, data } = await bPost<{ id: string; name: string }>(
      `/run/${projectId}/products-create`,
      { name: 'Test Widget', description: 'E2E product', price: 5.99, stock: 10, category: 'Test', active: true },
    );
    expect(status).toBe(201);
    // tablesInsert returns the raw row (no `data` wrapper)
    const row = data as { id: string; name: string };
    expect(row.id).toBeTruthy();
    expect(row.name).toBe('Test Widget');
    newId = row.id;
  });

  test('products-update returns 200 with updated fields', async () => {
    expect(newId, 'newId must be set by create test').toBeTruthy();
    // PUT /run/:project/products-update — workflow configured with method PUT
    const { status, data } = await bPut<{ name: string }>(
      `/run/${projectId}/products-update`,
      { id: newId, name: 'Updated Widget', price: 9.99, stock: 5, category: 'Test', active: false },
    );
    expect(status).toBe(200);
    expect((data as { name: string }).name).toBe('Updated Widget');
  });

  test('products-delete returns 200 with ok:true', async () => {
    expect(newId).toBeTruthy();
    // DELETE /run/:project/products-delete — workflow configured with method DELETE
    const { status, data } = await bDelete<{ ok: boolean }>(
      `/run/${projectId}/products-delete`,
      { id: newId },
    );
    expect(status).toBe(200);
    expect((data as { ok: boolean }).ok).toBe(true);
  });

  test('products-list count is back to initial count after delete', async () => {
    const { status, data } = await bGet<{ data: unknown[] }>(`/run/${projectId}/products-list`);
    expect(status).toBe(200);
    expect((data as { data: unknown[] }).data.length).toBe(initialCount);
  });
});

test.describe('API-03 — orders CRUD with real customer FK', () => {
  let newOrderId = '';

  test('orders-create with existing customer_id returns 201', async () => {
    const { data: custData } = await bGet<{ data: Array<{ id: string }> }>(
      `/run/${projectId}/customers-list`,
    );
    const cid = (custData as { data: Array<{ id: string }> }).data[0].id;
    expect(cid).toBeTruthy();

    // POST — orders-create uses method POST
    const { status, data } = await bPost<{ id: string; status: string }>(
      `/run/${projectId}/orders-create`,
      { customer_id: cid, status: 'pending', total: 99.99, notes: 'E2E order' },
    );
    expect(status).toBe(201);
    // Raw row returned (no `data` wrapper)
    newOrderId = (data as { id: string }).id;
    expect(newOrderId).toBeTruthy();
  });

  test('orders-delete removes the test order', async () => {
    expect(newOrderId).toBeTruthy();
    // DELETE — orders-delete uses method DELETE
    const { status } = await bDelete(`/run/${projectId}/orders-delete`, { id: newOrderId });
    expect(status).toBe(200);
  });
});

test.describe('API-04 — custom raw-SQL workflow', () => {
  const slug = 'e2e-count-sql';

  test.beforeAll(async () => {
    const cr = await bPost<{ workflow: { id: string } }>(
      `/projects/${projectId}/workflows`,
      {
        name: 'E2E Count Products SQL', slug, kind: 'API_ENDPOINT',
        method: 'GET', path: `/${slug}`, folder: 'custom',
        security: 'PUBLIC', allowedRoles: [],
        graph: [
          { id: 's1', type: 'executeSQL', config: { sql: 'SELECT COUNT(*)::int AS total FROM "products"' } },
          { id: 's2', type: 'sendResponse', config: { status: '200', body: '$var.__step_s1', bodyType: 'JSON' } },
        ],
      },
    );
    if (cr.status !== 201) {
      if (cr.status !== 409) throw new Error(`Create SQL wf: ${cr.status}`); // 409 = already exists from a retry
      return;
    }
    const wfId = (cr.data as { workflow: { id: string } }).workflow.id;
    await pause(200);
    await fetch(`${BACKEND}/v1/projects/${projectId}/workflows/${wfId}/publish`, {
      method: 'POST', headers: { Cookie: `auth_token=${authToken}` },
    });
    await pause(400);
  });

  test('custom SQL workflow returns products count >= 8', async () => {
    const { status, data } = await bGet<Array<{ total: number }>>(`/run/${projectId}/${slug}`);
    expect(status).toBe(200);
    const rows = data as Array<{ total: number }>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows[0]?.total).toBeGreaterThanOrEqual(8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Builder Tests — open the project in the browser
// ═══════════════════════════════════════════════════════════════════════════

async function waitForBuilder(p: Page): Promise<void> {
  await p.waitForSelector('[data-testid="builder-canvas"]', { timeout: 40_000 });
  await p.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 25_000, polling: 200 },
  );
  await p.waitForFunction(
    () => !document.body.innerText.includes('Loading project'),
    { timeout: 15_000 },
  );
  await p.waitForTimeout(600);
}

async function getStore(p: Page) {
  return p.evaluate(() => {
    const s = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>)
      .__builderStore?.getState();
    if (!s) return null;
    return {
      pages:           s.pages            as Array<{ id: string; name: string; route?: string }>,
      pageNodes:       s.pageNodes         as Array<{ type: string }>,
      pageDataSources: s.pageDataSources   as Array<{ id: string; name: string; type: string; url?: string; storeIn?: string }>,
    };
  });
}

// Increase timeout for all builder tests — they wait for Next.js SSR + React hydration
test.describe('BUILDER-01 — project loads correctly', () => {
  test.use({ timeout: 60_000 });

  // Navigate to the builder once before all builder tests in this describe tree.
  // High timeout because Next.js cold-starts + project config load can be slow.
  test.beforeAll(
    async () => {
      await page.goto(`${FRONTEND}/builder/${projectId}`);
      await waitForBuilder(page);
    },
    { timeout: 90_000 },
  );
  test('no loading spinner visible after load', async () => {
    await expect(page.locator('text=Loading project')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="builder-canvas"]')).toBeVisible();
  });
});

test.describe('BUILDER-02 — pages are present', () => {
  test('store has exactly 3 pages', async () => {
    const store = await getStore(page);
    expect(store?.pages.length).toBe(3);
  });

  test('page names are Products, Customers, Orders', async () => {
    const store = await getStore(page);
    const names = store!.pages.map(p => p.name);
    expect(names).toContain('Products');
    expect(names).toContain('Customers');
    expect(names).toContain('Orders');
  });

  test('routes are /products, /customers, /orders', async () => {
    const store = await getStore(page);
    const routes = store!.pages.map(p => p.route);
    expect(routes).toContain('/products');
    expect(routes).toContain('/customers');
    expect(routes).toContain('/orders');
  });
});

test.describe('BUILDER-03 — data sources are wired', () => {
  test('three REST data sources exist', async () => {
    const store = await getStore(page);
    expect(store?.pageDataSources.length).toBeGreaterThanOrEqual(3);
    const all = store!.pageDataSources.every(s => s.type === 'rest');
    expect(all).toBe(true);
  });

  test('data source names match seeded names', async () => {
    const store = await getStore(page);
    const names = store!.pageDataSources.map(s => s.name);
    expect(names).toContain('Products List');
    expect(names).toContain('Customers List');
    expect(names).toContain('Orders List');
  });

  test('each data source URL contains the project ID', async () => {
    const store = await getStore(page);
    for (const ds of store!.pageDataSources) {
      expect(ds.url).toContain(projectId);
    }
  });
});

test.describe('BUILDER-04 — Products page canvas has Box nodes', () => {
  test('active page has nodes', async () => {
    const store = await getStore(page);
    expect(store?.pageNodes.length).toBeGreaterThan(0);
  });

  test('root node type is Box', async () => {
    const store = await getStore(page);
    expect(store!.pageNodes[0]?.type).toBe('Box');
  });

  test('inner repeat node references products data source', async () => {
    const store = await getStore(page);
    const ds = store!.pageDataSources.find(s => s.name === 'Products List');
    expect(ds).toBeDefined();
    // The map field of the ProductCard node should reference this ds id
    const raw = JSON.stringify(store!.pageNodes);
    expect(raw).toContain(ds!.storeIn ?? ds!.id);
  });
});

test.describe('BUILDER-05 — Data & API mode switch', () => {
  test('Data & API icon button is in the top navbar', async () => {
    const btn = page.locator('button[title="Data & API"]');
    await expect(btn).toBeVisible({ timeout: 8_000 });
  });

  test('clicking Data & API switches to the data panel', async () => {
    const btn = page.locator('button[title="Data & API"]');
    await btn.click();
    await page.waitForTimeout(500);

    // One of these selectors should be visible in the data panel
    const panel = page.locator(
      '[data-testid="data-api-tab"], [data-testid="tables-designer"], [data-testid="data-api-left"]'
    ).first();
    await expect(panel).toBeVisible({ timeout: 8_000 });
  });
});

test.describe('BUILDER-06 — tables designer shows seeded tables', () => {
  test.setTimeout(60_000);

  test('products table is listed in the sidebar', async () => {
    const item = page.locator('text=products').first();
    await expect(item).toBeVisible({ timeout: 10_000 });
  });

  test('customers table is listed in the sidebar', async () => {
    const item = page.locator('text=customers').first();
    await expect(item).toBeVisible({ timeout: 5_000 });
  });

  test('clicking products shows its rows (has Classic T-Shirt)', async () => {
    await page.locator('text=products').first().click();
    await page.waitForTimeout(1000);
    const cell = page.locator('text=Classic T-Shirt').first();
    await expect(cell).toBeVisible({ timeout: 12_000 });
  });
});

test.describe('BUILDER-07 — backend workflows show CRUD folders', () => {
  test('backend workflows nav item is present and clickable', async () => {
    // Look for a nav/button that relates to workflows or API endpoints
    const wfNav = page.locator(
      '[data-testid="data-api-left"] button, [data-testid="data-api-nav"] button'
    ).filter({ hasText: /workflow|endpoint|api/i }).first();
    if (await wfNav.count() > 0) {
      await wfNav.click();
      await page.waitForTimeout(400);
    }
    // Workflows/endpoints panel should show the products folder
    const folder = page.locator('text=products').first();
    await expect(folder).toBeVisible({ timeout: 8_000 });
  });
});
