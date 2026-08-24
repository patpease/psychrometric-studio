/// <reference types="vite/client" />

/**
 * Build-time configuration.
 *
 * Declared rather than inferred so that a typo in an environment variable is a
 * type error instead of `undefined` at runtime — which, for the API base URL,
 * would mean silently posting projects to the development port in production.
 */
interface ImportMetaEnv {
  /** Base URL of the report service. Absent means "no PDF export offered". */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
