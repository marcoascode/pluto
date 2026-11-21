/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** "true" = roda com dados de exemplo gerados no navegador, sem servidor */
  readonly VITE_API_MOCK?: string;
  readonly VITE_ROUTER?: 'hash' | 'browser';
  /** Endereço do servidor Node.js usado pelo proxy do Vite em desenvolvimento */
  readonly VITE_API_PROXY_TARGET?: string;
  /** ID do App do Pluto Mídia na Meta (público): o gestor procura por ele ao gerar o token no Business Manager */
  readonly VITE_META_APP_ID?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
/** Versão do painel, lida de client/package.json no build (vite.config.ts). */
declare const __APP_VERSION__: string;
