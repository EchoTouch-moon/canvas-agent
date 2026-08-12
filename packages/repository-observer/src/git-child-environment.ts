// Repository reads never need provider credentials, shell startup hooks, Node
// preload hooks, or arbitrary parent-process configuration. Preserve only the
// small platform environment required to locate and start Git, then apply the
// fixed non-interactive Git configuration.
const GIT_CHILD_ENVIRONMENT_KEYS = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'WINDIR',
  'TMPDIR',
  'TMP',
  'TEMP'
] as const

export function buildRepositoryGitChildEnvironment(
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const key of GIT_CHILD_ENVIRONMENT_KEYS) {
    const value = source[key]
    if (value !== undefined) environment[key] = value
  }
  Object.assign(environment, {
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    LANG: 'C',
    LC_ALL: 'C'
  })
  return environment
}
