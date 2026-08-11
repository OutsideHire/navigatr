/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_INTERCOM_APP_ID?: string;
  readonly VITE_PATH_ADD_NEARBY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
