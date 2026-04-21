/**
 * NamedDataSourceDef — one entry in config/datasources.json
 *
 * The JSON key is a UUID (the unique datasource ID and store key).
 * Data is fetched and stored under the UUID key: store.data[UUID].
 * Access in formulas: collections['UUID']?.field
 *
 * The `label` field is the human-readable display name shown in the builder.
 * Optional `folder` groups the source under a named folder in the builder UI.
 */
export type NamedDataSourceDef = (RestDataSourceDef | GraphQLDataSourceDef) & {
  folder?: string;
  label?: string;
};

export interface RestDataSourceDef {
  type: 'rest';
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Array<{ key: string; value: string; enabled?: boolean }> | Record<string, string>;
  queryParams?: Array<{ key: string; value: string; enabled?: boolean }>;
  body?: string;
  /** Dot-path into the response to extract (e.g. "data.items"). Omit to store full response. */
  responsePath?: string;
  /** When true, proxy the request through the server to avoid CORS issues. */
  proxy?: boolean;
  /** When true, include credentials (cookies) in the request. */
  sendCredentials?: boolean;
}

export interface GraphQLDataSourceDef {
  type: 'graphql';
  /** GraphQL endpoint URL. Falls back to engineConventions.graphqlEndpoint. */
  endpoint: string;
  /** GraphQL query or mutation string. */
  query: string;
  /** Variables object; values support {{interpolation}} and { "var": "path" }. */
  variables?: Record<string, unknown>;
  /** Per-source headers merged on top of engineConventions.graphqlHeaders. */
  headers?: Record<string, string>;
  /** Dot-path into the response (e.g. "data.products.items"). */
  responsePath?: string;
  /** When true, skip storing when the response data is null. */
  skipStoreWhenNull?: boolean;
  /** Cache identifier. */
  cacheTag?: string;
  /** Cache TTL in seconds. */
  cacheTTL?: number;
  /** State paths whose values form the cache key (e.g. ["globalContext.browser.query.slug"]). */
  cacheKeyVars?: string[];
}
