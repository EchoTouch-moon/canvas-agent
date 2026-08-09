/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CANVAS_AGENT_ENABLE_FIXTURE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
