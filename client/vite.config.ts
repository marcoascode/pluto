import { defineConfig, loadEnv } from 'vite';
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
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_API_PROXY_TARGET || 'http://localhost:4000';
  const demo = mode === 'demo';
  return {
    plugins: demo ? [react(), viteSingleFile()] : [react()],
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
