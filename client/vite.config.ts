import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Em desenvolvimento o Vite repassa /api/* para o servidor Node.js (VITE_API_PROXY_TARGET),
 * removendo o prefixo /api. Assim não precisa de CORS e o cookie de sessão httpOnly funciona.
 * Em produção, o mesmo repasse é feito pelo Nginx (ver docs/INTEGRACAO.md).
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_API_PROXY_TARGET || 'http://localhost:4000';
  return {
    plugins: [react()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      port: 5173,
      proxy: { '/api': { target, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } },
    },
    preview: { port: 4173, proxy: { '/api': { target, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } } },
    build: {
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
