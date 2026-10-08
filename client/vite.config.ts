import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Em desenvolvimento o Vite repassa /api/* para o servidor Node.js (VITE_API_PROXY_TARGET),
 * removendo o prefixo /api. Assim não precisa de CORS e o cookie de sessão httpOnly funciona.
 * Em produção, o mesmo repasse é feito pelo Nginx (ver docs/INTEGRACAO.md).
 *
 * `npm run build:demo` (mode demo): o app inteiro em UM arquivo HTML com dados de exemplo (sem servidor),
 * para apresentar. Sai em dist-demo/index.html.
 */
/** Demo: em vez de embutir ~1 MB de fontes no HTML, carrega as mesmas famílias do Google Fonts (sem internet, cai na fonte do sistema). */
function demoFonts(): Plugin {
  const EMPTY = '\0demo-empty-font.css';
  return {
    name: 'pluto-demo-fonts',
    enforce: 'pre',
    resolveId: (id) => (id.startsWith('@fontsource/') ? EMPTY : null),
    load: (id) => (id === EMPTY ? '' : null),
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono&family=IBM+Plex+Sans:wght@400;500;600&family=Sora:wght@500;600;700&display=swap' }, injectTo: 'head' },
    ],
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_API_PROXY_TARGET || 'http://localhost:4000';
  const demo = mode === 'demo';
  return {
    plugins: demo ? [react(), demoFonts(), viteSingleFile()] : [react()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      port: 5173,
      proxy: { '/api': { target, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } },
    },
    preview: { port: 4173, proxy: { '/api': { target, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } } },
    build: demo ? { outDir: 'dist-demo', sourcemap: false, assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 10_000 } : {
      sourcemap: true,
      rollupOptions: {
        output: {
          // separa as bibliotecas grandes em arquivos próprios (cache melhor no navegador)
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('@mui/x-')) return 'mui-x';
            if (id.includes('@mui/icons-material')) return 'mui-icons';
            if (id.includes('@mui') || id.includes('@emotion')) return 'mui';
            if (/[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'react';
            return 'vendor';
          },
        },
      },
    },
  };
});
