/** Stub root config — real project data is loaded from the backend. */

const root = {
  routes: [] as Array<{ path: string; config: string; name?: string }>,
  screens: {} as Record<string, unknown>,
  dataSources: {} as Record<string, unknown>,
  sharedComponents: {} as Record<string, unknown>,
};

export default root;
