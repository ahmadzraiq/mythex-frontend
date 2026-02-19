/**
 * Shared in-memory product store for mock API.
 * Replace with database in production.
 */
export type Product = {
  id: string;
  name: string;
  price: number;
  category: string;
  description?: string;
};

const store = (global as unknown as { _productStore?: Product[] });
if (!store._productStore) {
  store._productStore = [
    { id: '1', name: 'Product A', price: 10, category: 'Cat 1', description: 'Description A' },
    { id: '2', name: 'Product B', price: 25, category: 'Cat 2', description: 'Description B' },
  ];
}

export const products = store._productStore;
