# Pluto Mídia — Front-end

Dashboard de compra de mídia × monetização (Google Ads + Meta Ads × Google Ad Manager).

**Stack:** React 19 · Vite 8 · TypeScript 5 (strict) · MUI 9 (Material UI) · MUI X Charts · MUI X Date Pickers · React Router 7 · TanStack Query 5 · Day.js.
Sem Next.js e sem HTML/CSS solto: toda a interface é feita com componentes MUI e estilizada pelo tema (`src/theme/theme.ts`) e `sx`.

## Rodar

```bash
npm install

# 1) Só o front, com dados de exemplo no navegador (sem servidor)
npm run dev:mock          # http://localhost:5173  ·  logins de exemplo abaixo

# 2) Front + servidor Node.js real (pasta ../server)
cp .env.example .env      # ajuste VITE_API_PROXY_TARGET (padrão http://localhost:4000)
npm run dev

# Build de produção
npm run build             # tsc -b && vite build → dist/
npm run preview           # serve o dist/ em http://localhost:4173 (com o mesmo proxy)
npm run typecheck
npm run build:demo        # o app inteiro em UM arquivo (dist-demo/index.html) com dados de exemplo, abre sem servidor
```

Usuários do modo mock (só existem no navegador, senhas de exemplo):

| E-mail | Senha | Perfil |
|---|---|---|
| `admin@exemplo.com` | `admin123` | SuperAdmin (admin principal — conecta integrações, muda a frequência do sync, vê o ícone de prévia mobile) |
| `ops@exemplo.com` | `admin123` | Admin (CRUD de tudo, inclusive contas; sem conectar integrações nem mudar frequência) |
| `socio@exemplo.com` | `socio123` | Gerente, sócio da Empresa A e da Empresa B (vê as duas, sem administração) |
| `socio.b@exemplo.com` | `socio123` | Gerente, sócio só da Empresa B |
| `gestor@exemplo.com` | `gestor123` | Gestor de dominioX.com e dominioY.com — só as campanhas das contas dele |

## Variáveis (`.env`)

| Variável | Uso |
|---|---|
| `VITE_API_PROXY_TARGET` | URL do servidor Node.js para o proxy do `vite dev`/`vite preview`. Não vai para o bundle. |
| `VITE_API_MOCK` | `true` = usa o servidor falso do navegador (`src/mocks`). Em produção deixe `false`. |

## Estrutura

```
src/
  main.tsx                 Providers: Theme MUI, CssBaseline, Localization (pt-BR), React Query, Router, Auth/Prefs/Filters
  App.tsx                  Rotas (páginas com lazy loading) + guarda de admin
  theme/theme.ts           Paleta Pluto (azul-escuro) e overrides dos componentes MUI
  types/api.ts             Contrato da API (fonte da verdade para o back-end)
  lib/
    api/client.ts          fetch com cookie de sessão, timeout, ApiError, 401 → /login
    api/endpoints.ts       Uma função por rota do Node
    api/keys.ts            Chaves do React Query
    format.ts metrics.ts period.ts   Formatação, fórmulas (ROI, Margem, RPS…), períodos
  hooks/queries.ts         Hooks useQuery/useMutation por tela
  context/                 Auth (sessão), Filters (data/domínio/moeda na URL), Prefs (métricas salvas por usuário)
  components/
    layout/                AppShell, Sidebar, Topbar, menu (nav.tsx)
    filters/               Botão "Data" (presets + calendário) e filtros do topo
    dashboard/             KPIs, faixa de atribuição, métricas GAM, cards/faixa de domínios
    campaigns/             Tabela Campanha → Conjunto → Criativo, drawer de países 🌐
    charts/                Spend vs Revenue (faixa de lucro), Lucro diário, tooltip completo
    ui/                    Logo, valores (ROI colorido, Profit, Delta), seletor de métricas, estados
  pages/                   Dashboard, Relatórios (dia e mês), Domínios, Domínio, URLs (com Drop-off), Google/Meta Ads, Ad Manager,
                           Attribution Health, UTM Debugger
  pages/admin/             Integrações (Google, Meta, GAM), Contas, Domínios, UTMs, Moedas, Usuários & Squads
  mocks/                   Servidor falso (só com VITE_API_MOCK=true)
docs/
  API.md                   Rotas, parâmetros e regras que o Node.js deve seguir
  INTEGRACAO.md            Proxy do Vite, Docker/Nginx, sessão, Squads e permissões, PostgreSQL, câmbio
```

## Regras que o back-end precisa garantir

- Senhas só com hash seguro (argon2id ou bcrypt). Convite enviado por `admin@plutomidia.com.br`.
- Filtro de Squad aplicado **no servidor** em toda consulta (gestor recebe `403` fora do Squad, mesmo mudando URL ou chamando a API direto).
- Receita sem atribuição nunca é rateada entre campanhas.
- Google/Meta/GAM conectados só por OAuth — o sistema nunca pede senha dessas contas.
