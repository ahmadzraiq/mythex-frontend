export function emitClearSession(): string {
  return [
    `// clearSession — remove auth token and reset auth state`,
    `if (typeof window !== 'undefined') {`,
    `  localStorage.removeItem('auth_token');`,
    `  localStorage.removeItem('access_token');`,
    `}`,
    `useStore.setState(s => ({ ...s, auth: { ...s.auth, token: null, user: null } }));`,
  ].join('\n');
}
