import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';

// Demonstração em arquivo único (npm run build:demo) abre via file:// → rotas com # no endereço.
const Router = import.meta.env.VITE_ROUTER === 'hash' ? HashRouter : BrowserRouter;
import { CssBaseline, ThemeProvider } from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'dayjs/locale/pt-br';
import { theme } from '@/theme/theme';
import { AuthProvider } from '@/context/AuthContext';
import { PrefsProvider } from '@/context/PrefsContext';
import { FiltersProvider } from '@/context/FiltersContext';
import { ApiError } from '@/lib/api/client';
import App from './App';

function Root() {
  const [qc] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        // não repete em 401/403/404; tenta 2x em erro de rede/servidor
        retry: (n, e) => !(e instanceof ApiError && [401, 403, 404].includes(e.status)) && n < 2,
      },
    },
  }));
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="pt-br">
        <QueryClientProvider client={qc}>
          <Router>
            <AuthProvider><PrefsProvider><FiltersProvider><App /></FiltersProvider></PrefsProvider></AuthProvider>
          </Router>
        </QueryClientProvider>
      </LocalizationProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
