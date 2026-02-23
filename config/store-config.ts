/**
 * Store config - reads from root.ts, merges with environment variables.
 * Use NEXT_PUBLIC_GRAPHQL_ENDPOINT and NEXT_PUBLIC_VENDURE_TOKEN for production.
 */

import root from './root';

type StoreConfig = (typeof root)['store'];

const storeJson = root.store as StoreConfig;
const engineConventions = { ...storeJson.engineConventions } as NonNullable<
  StoreConfig['engineConventions']
>;

const envEndpoint =
  typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_GRAPHQL_ENDPOINT : undefined;
const envToken =
  typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_VENDURE_TOKEN : undefined;

if (envEndpoint) {
  engineConventions.graphqlEndpoint = envEndpoint;
}
if (envToken) {
  engineConventions.graphqlHeaders = {
    ...engineConventions.graphqlHeaders,
    'vendure-token': envToken,
  };
}

const storeConfig: StoreConfig = {
  ...storeJson,
  engineConventions,
};

export default storeConfig;
