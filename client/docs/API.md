# Contrato da API — Pluto Mídia

O front (React + Vite) chama sempre `/api/<rota>` no mesmo domínio. Em desenvolvimento o proxy do Vite
(`VITE_API_PROXY_TARGET`) e em produção o Nginx repassam para o servidor Node.js **removendo o prefixo `/api`**,
então **as rotas abaixo são as do servidor Node, sem `/api`**. Detalhes em `docs/INTEGRACAO.md`.
Os tipos exatos de cada resposta estão em `src/types/api.ts` (é a fonte da verdade).

## Regras gerais

| Tema | Regra |
|---|---|
| Autenticação | Cookie de sessão **httpOnly, Secure, SameSite=Lax** (nome sugerido `pluto_session`; o front não lê o cookie, só envia com `credentials: 'include'`). O front nunca vê o token. |
| Erros | JSON `{ "error": { "code": "…", "message": "…" } }`. `401` = sessão expirada (o front manda para /login). `403` = sem permissão, domínio ou Empresa fora do alcance. |
| Escopo | **Toda** consulta de métricas passa por `scope()` (`server/src/auth/scope.ts`): Admin/SuperAdmin veem tudo · **sócio** de uma Empresa vê a Empresa inteira · **Gerente** vê os Squads dele · **Gestor** vê os domínios que gere e, em cada um, **só as campanhas das contas ligadas a ele** (a receita não atribuída do domínio só entra se ele for o único gestor). `domain` fora → `403 forbidden_domain`; `company` fora → `403 forbidden_company`. |
| Empresa | Toda rota de métricas aceita `company=<id>` (seletor "Empresa" do topo): reduz o escopo aos domínios dos Squads daquela Empresa. |
| Permissões | Módulos desligados para o Gestor em Usuários & Squads → Permissões respondem `403 forbidden_module` (Relatórios, URLs, Google Ads, Meta Ads, Ad Manager, Attribution Health, UTM Debugger). `/admin/*` é só Admin e SuperAdmin; conectar integrações (OAuth) e mudar a frequência do sync é só SuperAdmin (`403 superadmin_only`). |
| Filtros comuns | `from`, `to` (YYYY-MM-DD, inclusivo, no timezone da organização), `domain` (opcional), `company` (opcional), `currency` (`USD` \| `BRL` \| `EUR`). |
| Dinheiro | Já convertido para `currency` pela taxa **do dia de cada linha** (nunca somar moedas diferentes). Em **BRL**, a receita do Ad Manager usa **cotação − deságio** do dia (Moedas); o custo usa a cotação cheia. |
| Percentuais | Em pontos: `38.7` = 38,7%. Sem dado → `null`. |
| Papéis | `gestor` (domínio + contas dele, módulos liberados) · `gerente` (vários Squads, módulos liberados, **sem** `/admin`) · `admin` (tudo, inclusive CRUD de contas, menos conectar/frequência/janela/limpeza) · `superadmin` (tudo). Só SuperAdmin cria, edita ou promove SuperAdmin; o admin principal é sempre SuperAdmin. |
| Fórmulas | **Revenue** = receita bruta do Ad Manager × (1 − revShare do domínio no dia) · **Spend** = Google Ads + Meta Ads + IVA · **IVA** = Meta Ads × 13,83% · Profit = Revenue − Spend · ROI = Profit / Spend × 100 · Margem = Profit / Revenue × 100 · RPS = Revenue / Sessions × 1000 · Fill = Impressions / Ad Requests · **Drop-off = (Responses served − Impressions) / Responses served × 100** · Meta % / Google % = custo da plataforma / Spend × 100. |
| Receita sem atribuição | Nunca rateada entre campanhas. Entra no total do domínio como `unattributedRevenue`. |
| Comparação | `comparison` = mesmo número de dias imediatamente antes. Se o período inclui hoje e tem mais de 1 dia, compara sem o dia de hoje. Se é só hoje → `null`. |

## Autenticação e usuário

| Método | Rota | Corpo / Query | Resposta |
|---|---|---|---|
| POST | `/auth/login` | `{ email, password }` | `{ user }` + grava o cookie |
| POST | `/auth/logout` | — | 204, apaga o cookie |
| GET | `/auth/me` | — | `{ user }` ou 401 |
| POST | `/auth/forgot-password` | `{ email }` | 204 (sempre, para não revelar se o e-mail existe) |
| POST | `/auth/change-password` | `{ currentPassword \| null, newPassword }` | 204. `currentPassword` null só quando `mustChangePassword`. Senha: 10+ caracteres com letras e números. Encerra as outras sessões |
| POST | `/auth/reset-password` | `{ token, newPassword }` | 204. `token` vem do link do e-mail (`/login?reset=…`), vale 1 h e uma vez só |
| GET/PUT | `/me/preferences` | `Preferences` | `Preferences` (métricas escolhidas, densidade, ordem dos domínios…) |
| GET | `/me/domains` | `company?` | `{ domains: string[] }` (os que o usuário pode ver, já filtrados pela Empresa) |
| GET | `/me/companies` | — | `{ companies: MyCompany[] }` — Empresas visíveis com sócios, Squads e domínios (seletor do topo) |
| GET | `/companies/:id/overview` | `from`, `to`, `currency` | `CompanyOverviewResponse` — totais, comparação, série diária, Squads → domínios → gestores. `403` fora do alcance |
| GET | `/search` | `q` | `{ results: SearchResult[] }` (campanhas por nome/ID, domínios) |

## Métricas

| Método | Rota | Query extra | Resposta (`src/types/api.ts`) |
|---|---|---|---|
| GET | `/dashboard` | — | `DashboardResponse` (métricas, comparação, série diária **dos últimos 14 dias no mínimo**, domínios, `lastSyncAt`) |
| GET | `/domains/summary` | — | `{ domains: DomainSummary[] }` |
| GET | `/domains/:hostname` | — | `DomainDetailResponse` (inclui `campaignTotals` só das campanhas) |
| GET | `/campaigns` | `platform=google\|meta`, `accountId?`, `includePaused?` | `CampaignsResponse` (com `roiDays` = ROI Hoje, D-1, D-2, D-3) |
| GET | `/campaigns/:platform/:id/children` | — | `CampaignChildrenResponse` (Google: Ad Group → Ad · Meta: Ad Set → Ad) |
| GET | `/campaigns/:platform/:id/countries` | — | `CampaignCountriesResponse` |
| GET | `/urls` | — | `UrlsResponse` |
| GET | `/placements/filters` | `domain` (obrigatório) | `PlacementFiltersResponse` — contas e campanhas Google Ads do domínio |
| GET | `/placements` | `domain` (obrigatório), `accounts?`, `campaigns?` (listas separadas por vírgula; vazio = todas) | `PlacementsResponse` — placements agrupados pelo domínio principal |
| GET | `/placements/campaigns` | os mesmos + `placement`, `level=root\|host` | `PlacementCampaignsResponse` — campanhas que gastaram no placement |
| GET | `/gam/summary` | — | `GamSummaryResponse` |
| GET | `/reports/daily` | `month=YYYY-MM`, `domain?`, `currency` (sem `from`/`to`) | `DailyReportResponse` — um dia por linha do mês + `total` do mês |
| GET | `/reports/monthly` | `months` (padrão 14, máx. 36), `domain?`, `currency` | `MonthlyReportResponse` — um mês por linha (atual primeiro) + `total` |
| GET | `/attribution/health` | — | `AttributionHealthResponse` |
| GET | `/utm/templates` | — | `UtmTemplates` |
| POST | `/utm/debug` | `{ url }` | `UtmDebugResponse` |
| GET | `/fx/latest` | — | `FxLatest` |
| GET | `/fx/history` | `days` | `{ rows: FxHistoryRow[] }` |

## Relatórios (aba "Relatórios")

- `/reports/daily` e `/reports/monthly` seguem as mesmas regras de Squad e moeda das outras rotas (gestor com `domain` fora do Squad → `403`).
- Cada dia/mês já vem convertido pela taxa **de cada dia** antes de somar.
- `partial: true` quando a linha contém hoje ou D-1 a D-3 (receita ainda pode ser ajustada).
- Devolva **todas** as métricas de `Metrics`; o usuário escolhe as colunas no front ("Selecionar métricas").
- SQL (PostgreSQL): `GROUP BY to_char(m.date, 'YYYY-MM')` sobre `daily_metrics` — ver `server/src/services/metrics.ts`.

## Placements (aba "Placements", em Campanhas)

Onde os anúncios do Google Ads apareceram (sites, apps, YouTube) × receita do Ad Manager naquele placement.

- **Fluxo da tela:** 1) Domínio (obrigatório) → 2) Contas Google Ads do domínio → 3) Campanhas → "Pesquisar placements". Sem domínio a rota responde `422 domain_required`. Domínio fora do Squad → `403`. Permissão: `campaigns.google.view`.
- O Domínio do topo some nesta tela (é o passo 1). Data e Moeda do topo continuam valendo. A pesquisa aplicada fica na URL do front (`/placements?d=&a=&c=`).
- **Spend** = custo do Google Ads no placement (`detail_placement_view`: Display, Demand Gen, YouTube). Pesquisa não tem placement; Performance Max não informa custo por placement.
- **Revenue** = receita bruta do Ad Manager pelo key-value `placement` × (1 − revShare do domínio no dia). Sem IVA (é só Google).
- **Chave do placement** (igual nos dois lados): host sem `www.` (`lp.site.com`), `youtube.com` para vídeos/canais, `mobileapp::…` para apps.
- **Agrupamento:** `PlacementGroup.key` = domínio principal (`lp.site.com`, `m.site.com` → `site.com`; respeita `com.br`, `co.uk`…). `children` traz cada subdomínio (inclui o próprio domínio quando ele aparece).
- Cada linha traz `roiDays` (ROI Hoje/D-1/D-2/D-3) e `recent` (`[spend, revenue]` desses 4 dias) para o front calcular o ROI D-x do total quando a lista é filtrada.
- Busca, "Dão ROI / Prejuízo", critério (ex.: ROI ≤ −10%), ordenação e "Selecionar métricas" são feitos no front sobre a resposta.
- Sessions e RPS dependem do tracking próprio do site (vêm 0 / null até existir).

## Ordem das colunas

ROI e ROI Hoje / D-1 / D-2 / D-3 ficam **sempre na ponta direita** das tabelas, nessa ordem. Qualquer métrica escolhida em "Selecionar métricas" entra à esquerda do ROI (`roiLast()` em `src/lib/metrics.ts`, aplicado em `usePicked`).

## Drop-off (Google Ad Manager)

- Fórmula: `dropOffRate = (responsesServed − impressions) / responsesServed × 100` — porcentagem de respostas de anúncio que não viraram impressão (mesma definição do Google para AdSense/Ad Exchange).
- `responsesServed` vem do relatório do Ad Manager (`RESPONSES_SERVED` na Ad Manager API v1 / "Total code served count" na UI). Não há um campo "drop-off" pronto na API: ele é **calculado** pelo servidor, sempre a partir das somas (nunca média de percentuais).
- Precisa estar em todas as quebras: total, dia, domínio, **URL**, país e campanha (via key-values).
- Alertas da tela de URLs: ≥ 20% vermelho, 12–20% amarelo; só entram URLs com ≥ 200 respostas servidas no período.

## IVA (Meta Ads)

- `iva` = gasto da Meta × 13,83% (`app_settings.meta_iva_rate`). É gravado em `daily_metrics.iva_usd` na importação (com a alíquota vigente) e entra em `spend` junto com Google e Meta.
- `metaSpend` é o gasto da Meta **sem** IVA; `spend` já inclui o IVA. Nos relatórios aparece como a coluna **IVA**, ao lado de Custo Google e Custo Meta.
- Para mudar a alíquota: `UPDATE app_settings SET value = '{"rate": 0.1383}' WHERE key = 'meta_iva_rate';` (vale para as próximas importações; a janela D-3 → hoje é recalculada no próximo sync).

## revShare (por domínio)

- Percentual da receita do Ad Manager que a Network (ex.: Publeno) retém. Fica em `domain_rev_shares (domain_id, valid_from, rev_share)`.
- `revenue` (o que aparece em todas as telas) = receita bruta × (1 − revShare vigente **no dia da linha**). O revShare **não** aparece em relatório nem no seletor de métricas.
- `PATCH /admin/domains/:hostname` com `{ revShare: 20, revShareFrom?: "YYYY-MM-DD" }`. O primeiro valor vale para todo o histórico; os seguintes valem a partir de `revShareFrom` (padrão: hoje), sem mudar os dias anteriores.
- `grossRevenue` continua na API (uso interno), mas não é exibido.

## Administração (Admin e SuperAdmin — o servidor responde 403 para Gestor e Gerente)

Implementado em `server/src/routes/admin/*`. Erros de regra de negócio voltam como `409` (conflito) ou `422` (dado inválido) com `{ error: { code, message } }`.

### Usuários e permissões
| Método | Rota | Corpo | Resposta / regra |
|---|---|---|---|
| GET | `/admin/users` | — | `{ users: User[] }` |
| POST | `/admin/users` | `CreateUserRequest` | `201 CreateUserResponse`. Senha temporária gerada no servidor (hash argon2id) e enviada por e-mail; `inviteSent: false` se o SMTP falhar. Vínculos: `squadIds` (só Gerente), `companyIds` (sócio, qualquer papel), `domains: DomainLink[]` (só Gestor: domínio + contas Google/Meta que ele usa ali; as contas entram também nas contas do domínio) |
| PATCH | `/admin/users/:id` | `UpdateUserRequest` | `User`. Cada campo de vínculo que vier substitui o anterior; trocar o papel limpa os vínculos que não valem para o novo papel. Não pode mudar a própria permissão nem se desativar; admin principal é sempre SuperAdmin. Admin não altera SuperAdmin (`403 superadmin_only`). `disabled` encerra as sessões |
| DELETE | `/admin/users/:id` | — | 204. Bloqueado para o admin principal e para si mesmo |
| POST | `/admin/users/:id/resend-invite` | — | `{ inviteSent }`. Gera nova senha temporária (só para `invited`) |
| GET | `/admin/permissions` | — | `PermissionsResponse` |
| PUT | `/admin/permissions` | `{ gestor?: Capability[], gerente?: Capability[] }` | `PermissionsResponse`. Capacidades `admin.*` são ignoradas para Gestor e Gerente |

### Empresas
| Método | Rota | Corpo | Resposta / regra |
|---|---|---|---|
| GET | `/admin/companies` | — | `{ companies: Company[] }` |
| POST · PUT | `/admin/companies` · `/admin/companies/:id` | `{ name, partnerIds, squadIds }` | `Company`. Um Squad fica em uma Empresa só (escolher aqui tira da anterior). `409 company_exists` com nome repetido |
| DELETE | `/admin/companies/:id` | — | 204. Os Squads ficam sem Empresa |

### Squads
| Método | Rota | Corpo | Resposta / regra |
|---|---|---|---|
| GET | `/admin/squads` | — | `{ squads: Squad[] }` |
| POST · PUT | `/admin/squads` · `/admin/squads/:id` | `{ name, domains, companyId? }` | `Squad`. Um domínio fica em um Squad só (se estava em outro, muda). `userIds` = Gerentes que veem o Squad |
| DELETE | `/admin/squads/:id` | — | 204. Domínios ficam sem Squad; Gerentes deixam de ver; gestores continuam pelos vínculos deles |

### Domínios
| Método | Rota | Corpo | Resposta / regra |
|---|---|---|---|
| GET | `/admin/domains` | — | `{ domains: Domain[] }` |
| POST | `/admin/domains` | `{ hostname }` | `201 Domain` (normaliza: sem https://, www. e caminho) |
| PATCH | `/admin/domains/:hostname` | `DomainInput` | `Domain`. Renomear, ativar/desativar, Squad, contas Google/Meta (ids), `gamAccountId` (a conta do Ad Manager do domínio — uma só). `managers` (gestores + contas) vem na resposta e é editado em `/admin/users` |
| DELETE | `/admin/domains/:hostname` | — | 204. `409 domain_has_data` se tiver histórico (desative em vez de excluir) |
| PUT | `/admin/utm-templates` | `{ google, meta }` | `UtmTemplates` |

**Domínio técnico `sem-dominio` ("Sem domínio"):** vem em `/admin/domains` com `technical: true`. Recebe o custo de campanhas sem domínio identificável (ex.: Meta de mensagens/chatbot) para o spend e o IVA baterem com a fatura. Só Admin/SuperAdmin enxergam (em `/dashboard`, `/domains/*`, `/campaigns`…). Para Gestor/Gerente/sócio ele não existe: `?domain=sem-dominio` → `403`. PATCH/DELETE → `409 technical_domain`; não entra em Squad, gestor, conta nem rede do Ad Manager (também bloqueado no banco).

### Campanhas sem domínio (mapeamento manual campanha → domínio)
| Método | Rota | Corpo | Resposta / regra |
|---|---|---|---|
| GET | `/admin/campaigns/unmapped?platform=meta&days=30` | — | `{ platform, days, campaigns: UnmappedCampaign[], totals: { spend, rows } }`. Campanhas com custo em "Sem domínio" nos últimos `days` dias (as do aviso da conta) + as ativas ainda sem domínio. `spend` em USD com IVA |
| PATCH | `/admin/campaigns/:id` | `{ domain: "site.com" \| null, platform?: "meta" \| "google", resync?: true }` (ou `domainId`) | `{ campaign: { id, platform, name, domain, domainManual }, movedRows, resync: "started" \| "queued" \| null }`. `:id` = id da campanha na plataforma. Grava `campaigns.domain_id` + `domain_manual` (o sync não troca e vale sobre o link dos anúncios). Move na hora as linhas já gravadas dessa campanha para o domínio (inclusive as de "Sem domínio") e roda o job de métricas da plataforma em segundo plano (`queued` = já estava rodando; roda de novo ao terminar). `domain: null` volta para o automático. `409 technical_domain` / `409 domain_inactive` / `404` |

`GET /campaigns` traz `noDomain: true` (e `domain: "sem-dominio"`) nas campanhas sem domínio, só para Admin; a tela mostra o seletor de domínio no lugar do domínio. `domainManual: true` quando o domínio foi definido à mão.

### Integrações, contas e sincronização
| Método | Rota | Corpo | Resposta / regra |
|---|---|---|---|
| GET | `/admin/integrations` | — | `IntegrationsResponse` (resumo das 3 conexões) |
| POST | `/admin/integrations/:provider/oauth/start` | — | **Só SuperAdmin.** `{ authorizeUrl }` — o front redireciona. `501 oauth_not_configured` sem as chaves no `.env` |
| GET | `/admin/integrations/:provider/oauth/callback` | (o Google/Meta chama) | troca o `code`, grava os tokens criptografados (AES-256-GCM) e volta para `/admin/integracoes/...` |
| GET | `/admin/integrations/:provider/accounts` | — | `{ accounts: IntegrationAccount[] }` (`provider` = `google-ads` \| `meta` \| `gam`) |
| POST | `/admin/integrations/:provider/accounts` | `IntegrationAccountInput` | `201 IntegrationAccount`. Valida o ID (Google 10 dígitos · Meta `act_…` · GAM network code) |
| PATCH | `/admin/integrations/:provider/accounts/:id` | `Partial<IntegrationAccountInput>` (sem `externalId`) | `IntegrationAccount` (importar, domínios, moeda, timezone, nome) |
| DELETE | `/admin/integrations/:provider/accounts/:id` | — | 204. Sai do sync e dos domínios; o histórico fica |
| POST | `/admin/integrations/:provider/sync` | — | `202` (roda em segundo plano) |
| GET | `/admin/sync-settings` | — | `{ settings: SyncSetting[] }` (um por job, inclusive `fx.rates`) |
| PATCH | `/admin/sync-settings/:id` | `{ everyMinutes?, enabled?, windowMode?, windowDays?, retentionDays? }` | **Só SuperAdmin.** `SyncSetting`. Frequência 15 min a 1 semana. Janela: `windowMode='days'` + `windowDays` (0–90) = D-X → hoje, ou `'incremental'` (desde a última execução com sucesso). `gam.close` = D-X → D-4 (X ≥ 4). Estrutura/câmbio/limpeza não têm janela (`422 window_fixed`). `retentionDays` (7–3650 ou null) só nos jobs `*.cleanup` |
| GET · PUT | `/admin/fx-discount` | `{ amount, validFrom? }` | `FxDiscountResponse`. Deságio em R$ (0–4,9999). O primeiro vale para todo o histórico; os seguintes a partir de `validFrom` (padrão hoje) |
| POST | `/admin/fx/refresh` | — | `FxLatest` — busca a cotação agora (Frankfurter; reserva open.er-api.com). `FxLatest` traz `brlDiscount` e `brlRevenueRate` (cotação − deságio) |
