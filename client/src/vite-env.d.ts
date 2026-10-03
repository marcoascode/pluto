/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** "true" = roda com dados de exemplo gerados no navegador, sem servidor */
  readonly VITE_API_MOCK?: string;
  /** Endereço do servidor Node.js usado pelo proxy do Vite em desenvolvimento */
  readonly VITE_API_PROXY_TARGET?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
