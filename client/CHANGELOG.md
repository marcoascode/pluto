# Changelog

## 0.6.0
- **Nova aba Placements** (`/placements`, em Campanhas, abaixo de Meta Ads · `src/pages/Placements.tsx`):
  - Filtro em 3 passos: **Domínio** (obrigatório) → **Contas Google Ads** do domínio → **Campanhas** → "Pesquisar placements". Contas e campanhas com seleção múltipla ("Todas" ou só as marcadas). A pesquisa fica na URL (`?d=&a=&c=`). O Domínio do topo some nessa tela; Data e Moeda continuam.
  - Cards de Revenue/Spend/Profit/ROI/Margem, resumo "Dão ROI · Com prejuízo · Lucro sem os de prejuízo · Melhor ROI".
  - Tabela agrupada pelo domínio principal (subdomínios `lp.`, `m.`, `blog.`… abrem na seta), Margem colorida, ROI D-1/D-2/D-3, ordenação em todas as colunas (clique inverte), busca, filtro Todos / Dão ROI / Prejuízo, critério (ex.: ROI ≤ −10%), "Selecionar métricas", "Abrir subdomínios" e "Mostrar mais".
  - Ícone de lista abre as campanhas que gastaram naquele placement (`PlacementDrawer`).
- **Regra das colunas:** ROI e ROI Hoje / D-1 / D-2 / D-3 sempre na ponta direita; qualquer métrica adicional entra à esquerda do ROI (`roiLast` em `lib/metrics.ts`, vale para todas as tabelas e para escolhas já salvas). Gaveta de países: RPS antes do ROI.
- Tipos novos em `types/api.ts`: `PlacementFiltersResponse`, `PlacementQuery`, `PlacementRow`, `PlacementGroup`, `PlacementsResponse`, `PlacementCampaignsResponse`. Rotas novas em `docs/API.md`.
- Servidor: migration `003_placements.sql`, jobs `google-ads.placements` e `gam.placements` (`server/src/services/sync/placements.ts`), rotas `server/src/routes/placements.ts`.

## 0.5.0
- **Workers de sincronização** no servidor (Meta, Google Ads, Ad Manager → `daily_metrics`). Ver `docs/INTEGRACAO.md` → Sincronização.
- **IVA (13,83% do spend Meta):** novo campo `iva` em `Metrics`; Spend = Google + Meta + IVA. Card de Spend mostra Google · Meta · IVA; Relatórios ganham a coluna IVA; spend das campanhas Meta inclui IVA.
- **revShare por domínio:** campo "revShare (%)" e "Vale a partir de" em Domínios. Revenue em todas as telas já é líquida; o revShare não aparece nos relatórios. `Domain` ganha `revShare`, `revShareFrom`, `createdBySync`.
- **Papéis:** `gestor` | `admin` | `superadmin`. "Acesso Total" virou **Admin** (CRUD completo, inclusive contas). Só o **SuperAdmin** conecta integrações e muda a frequência do sync (nova capability `admin.integrations.connect`).
- Removidos de `Metrics`: `retention` (e "Receita bruta" saiu dos seletores de métricas).
- Domínios vistos no Ad Manager e ainda não cadastrados aparecem inativos ("Visto no Ad Manager").

## 0.4.0
- **CRUD completo no admin:** Usuários (editar, desativar, excluir, reenviar convite), Squads (excluir), **Permissões** editáveis por papel (módulos do Gestor), Domínios (editar Squad/contas, renomear, excluir) e **Contas** de Google Ads, Meta Ads e Ad Manager (adicionar, editar, importar, excluir).
- **Frequência das sincronizações** editável por job (15 min a 24 h, ligar/desligar) em cada tela de integração e em Moedas.
- **Câmbio real:** "Atualizar agora" em Moedas; fonte Frankfurter no servidor.
- Login: tela "Nova senha" pelo link do e-mail (`/login?reset=…`); senha mínima 10 caracteres com letras e números.
- Menu e rotas respeitam as permissões do usuário (`user.permissions`).
- Novo backend em `../server` (Express + PostgreSQL) e deploy Docker na raiz.

## 0.3.0
- **Nova aba Relatórios** (`/relatorios`, `src/pages/Reports.tsx`): Resultados diários (mês escolhido) e mensais (últimos 14 meses), com linha de total, barras nas colunas de dinheiro, Margem com fundo colorido, ROI colorido e marcação "parcial" (hoje a D-3). Clicar num mês abre os dias dele. Colunas escolhidas em "Selecionar métricas" (salvo por usuário). A Data do topo some nessa tela; Domínio e Moeda continuam valendo.
- **Drop-off do Google Ad Manager** = (Responses served − Impressions) / Responses served × 100.
  - URLs: painel no topo (drop-off do período, URLs acima de 20%, receita estimada perdida, piores URLs), coluna colorida, etiqueta "drop-off alto" e ranking "Drop-off (maior)".
  - Também em Métricas Monetização (home), gráfico diário + tooltip, Ad Manager e Relatórios.
- Novos campos em `Metrics` (`src/types/api.ts`): `grossRevenue`, `retention`, `googleShare`, `metaShare`, `responsesServed`, `dropOffRate`.
- Novas rotas: `GET /reports/daily`, `GET /reports/monthly` (ver `docs/API.md`).
- Banco: colunas `responses_served` e `gross_revenue_usd` (hoje em `server/migrations/001_init.sql`).
