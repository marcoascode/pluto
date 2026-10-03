# Changelog

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
