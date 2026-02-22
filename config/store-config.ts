/**
 * Store config - merges store.json with environment variables.
 * Use NEXT_PUBLIC_GRAPHQL_ENDPOINT and NEXT_PUBLIC_VENDURE_TOKEN for production.
 */

import storeJson from './store.json';

type StoreConfig = typeof storeJson;

const envEndpoint = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_GRAPHQL_ENDPOINT : undefined;
const envToken = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_VENDURE_TOKEN : undefined;

const base = storeJson as StoreConfig;
const engineConventions = { ...base.engineConventions } as NonNullable<StoreConfig['engineConventions']>;

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
  ...base,
  engineConventions,
};

export default storeConfig;
