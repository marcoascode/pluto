# Integração Front (React + Vite) ↔ Node.js (Express) ↔ PostgreSQL

```
Navegador ──https──▶ Nginx do servidor (443)
                       ├─ /api/*  ──▶ 127.0.0.1:4000  container api  (Node + Express) ──▶ container db (PostgreSQL 16)
                       └─ /*      ──▶ 127.0.0.1:8400  container web  (Nginx + dist/ do React)
Desenvolvimento:  Vite :5173 ──/api/*──▶ Node :4000 (proxy do Vite)
```

O front **sempre** chama `/api/<rota>` no mesmo domínio. O proxy remove o `/api` antes de repassar,
então no Node as rotas ficam `/auth/login`, `/dashboard` etc. (lista completa em `docs/API.md`,
tipos em `src/types/api.ts`). Como tudo sai do mesmo domínio, **não precisa de CORS**.
Deploy passo a passo: `docs/DEPLOY.md` na raiz do projeto.

## Desenvolvimento

```bash
# banco local (Docker)
docker run -d --name pluto-db -e POSTGRES_USER=pluto -e POSTGRES_PASSWORD=pluto -e POSTGRES_DB=pluto -p 54321:5432 postgres:16-alpine
# API
cd server && cp .env.example .env && npm install && npm run dev        # :4000 (migrations rodam sozinhas)
# Front
cd client && cp .env.example .env && npm install && npm run dev        # :5173
```
`client/.env`: `VITE_API_PROXY_TARGET=http://localhost:4000` e `VITE_API_MOCK=false`.
Sem servidor? `npm run dev:mock` usa o servidor falso do navegador (`src/mocks`).

## Produção

- `client/Dockerfile`: build do Vite com Node 22 → `nginx:alpine` servindo o `dist/` (`client/nginx.conf`: `try_files` do SPA, cache de `/assets`, cabeçalhos de segurança, CSP).
- `server/Dockerfile`: compila o TypeScript → `node dist/server.js` (usuário `node`, `tini`).
- `docker-compose.yml`: `web` 8400:80 · `api` 4000:4000 · `db` 54321:5432, todos em `127.0.0.1` e na rede `pluto_net`.
- `deploy/nginx-host.conf`: bloco do Nginx principal (443) que divide `/api/` → 4000 e `/` → 8400.
- Express atrás do Nginx: `trust proxy` confia em proxies com IP privado/loopback (`TRUST_PROXY`), para o cookie `Secure` e o rate limit verem o IP real.

## Sessão

- `POST /auth/login` → o Node confere a senha (**argon2id**, nunca texto puro) e responde
  `Set-Cookie: pluto_session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/`.
- No banco fica só o **sha256 do token** (`sessions.token_hash`) para revogar: logout, troca de senha, desativar ou excluir usuário.
- O front manda o cookie em toda chamada (`credentials: 'include'`) e não lê o token. `401` → volta para `/login`.
- CSRF: cookie `SameSite=Lax` + o servidor recusa `POST/PUT/PATCH/DELETE` com `Origin` diferente de `APP_URL`.
- Login: limite de 10 tentativas / 15 min por IP. Senha nova: 10+ caracteres com letras e números.
- Convite: `POST /admin/users` gera a senha temporária, guarda o hash, marca `must_change_password` e envia
  o e-mail por `admin@plutomidia.com.br` (SMTP do `.env`). A senha temporária nunca volta para o front.
- Esqueci a senha: link `/login?reset=<token>` válido por 1 h (`password_resets`, também só o hash).

## Escopo, Empresas e permissões (obrigatório no servidor)

`server/src/auth/scope.ts` resolve os domínios permitidos e **toda** rota de métricas passa por ele:

Estrutura: **Empresa** (sócios) → **Squads** → **domínios** → **gestores** (cada um com as contas Google/Meta que usa naquele domínio).
Um domínio fica em uma conta do Ad Manager (`domains.gam_account_id`).

| Quem | Vê | Tabelas |
|---|---|---|
| Admin / SuperAdmin | todos os domínios ativos | — |
| Sócio (qualquer papel) | todos os domínios dos Squads da Empresa, completos | `company_users`, `squads.company_id` |
| Gerente | todos os domínios dos Squads dados a ele, completos | `squad_users` (vários por usuário) |
| Gestor | os domínios que gere; em cada um, **só as campanhas das contas ligadas a ele**. Não atribuída do domínio só se for o único gestor | `domain_managers`, `domain_manager_accounts` |

```ts
const sc = await scope(req, req.query.domain);   // ?company= é lido aqui também
aggregate({ domainIds: sc.ids, filter: sc.filter, ... });   // filter é obrigatório no tipo: nenhuma rota esquece
// filter (Gestor): m.domain_id = ANY(full) OR m.campaign_id = ANY(campanhas dele) OR (não atribuída AND domínio solo)
// listas de campanhas: canSeeCampaign(sc, campaignId, domainId)
```

O seletor **Empresa** do topo manda `company=<id>` em toda chamada; `/me/companies` lista as Empresas visíveis e `/companies/:id/overview` monta o painel da Empresa (`/empresas/:id` no front).

Módulos (Relatórios, URLs, Google, Meta, Ad Manager, Atribuição, UTM Debugger) podem ser desligados para Gestor e Gerente em
**Usuários & Squads → Permissões** (`role_permissions`); o servidor responde `403 forbidden_module`. `/admin/*` é só Admin e SuperAdmin (Gerente nunca); conectar integrações e mudar frequência, janela e limpeza do sync é só SuperAdmin.

Login: no máximo 10 tentativas **erradas** por IP a cada 15 min (logins certos não contam, para várias pessoas no mesmo escritório).

## PostgreSQL

- Esquema em `server/migrations/001_init.sql` (aplicado sozinho no boot, controlado por `schema_migrations`). Nova mudança = novo arquivo `002_…sql`.
- Biblioteca `pg` com pool (`server/src/db.ts`) e **sempre** placeholders `$1, $2…` (nada de concatenar SQL).
- Dinheiro em `NUMERIC(14,4)`, sempre em USD na tabela. Na consulta, cada linha é convertida pela taxa **do próprio dia** (`currency_rates`) antes de somar.
- Datas em `DATE` no timezone da organização (`APP_TZ`).
- Fatos em `daily_metrics` (dia × domínio × URL × campanha/grupo/anúncio × país). Receita sem UTM válida fica com `platform = 'none'` + `unattributed_reason` e sai como `unattributedRevenue` — nunca rateada entre campanhas.
- Tokens OAuth (Google Ads, Meta, GAM) criptografados com AES-256-GCM; a chave fica em `TOKEN_ENCRYPTION_KEY` (ou no nome antigo `TOKEN_ENC_KEY`), fora do banco. Perfis Meta de contingência (0.18.2) usam a mesma chave para o Long-Lived User Token do Facebook Login.

## Câmbio

- `server/src/services/fx.ts`: Frankfurter (`https://api.frankfurter.dev/v2/rates?base=USD&quotes=BRL,EUR`, sem chave), com reserva em `open.er-api.com`.
- No primeiro boot baixa ~14 meses de histórico; depois o job `fx.rates` (padrão a cada 6 h, ajustável na tela Moedas) busca o dia e preenche os dias que faltarem repetindo a última taxa (fim de semana/feriado).
- `POST /admin/fx/refresh` força a busca na hora (botão "Atualizar agora").

## Sincronização (workers)

`sync_settings` guarda a frequência de cada job (só o SuperAdmin muda); `server/src/services/scheduler.ts` roda os vencidos a cada minuto
(`FOR UPDATE SKIP LOCKED`, retry com backoff). Cada worker grava só as linhas da sua origem (`daily_metrics.source`) e substitui a janela inteira numa transação: rodar de novo não duplica.

| Job | Arquivo | O que faz |
|---|---|---|
| `meta.structure` / `meta.metrics` | `services/sync/meta.ts` | `/act_{id}/ads` (campanha, conjunto, link do criativo → domínio e URL) e `/act_{id}/insights` por anúncio × país × dia. Custo → USD pela taxa do dia; **IVA = custo × 13,83%** |
| `google-ads.structure` / `google-ads.metrics` | `services/sync/googleAds.ts` | GAQL: contas da MCC (`customer_client`), anúncios com URL final, custo por anúncio/dia + custo por campanha/dia (pega Performance Max) + país por campanha (`geographic_view`). O custo do anúncio é dividido entre os países na proporção da campanha no dia |
| `gam.revenue` / `gam.close` | `services/sync/gam.ts` | Relatório oculto `DATE × SITE × COUNTRY_CODE × key-values` em USD (REVENUE, IMPRESSIONS, AD_REQUESTS, RESPONSES_SERVED, CLICKS, ACTIVE_VIEW_VIEWABLE_IMPRESSIONS). Receita gravada bruta |
| `google-ads.placements` | `services/sync/placements.ts` | GAQL `detail_placement_view` por campanha × placement × dia (custo, cliques, impressões) → `placement_metrics` (source `google-ads`). Nome de apps/YouTube em `placement_labels` |
| `gam.placements` | `services/sync/placements.ts` | Relatório oculto `DATE × SITE × COUNTRY_CODE × utm_campaign × placement` → `placement_metrics` (source `gam`). Linhas de campanhas Meta são ignoradas. `gam.close` também refaz D-7 → D-4 dos placements |
| `fx.rates` | `services/fx.ts` | Câmbio |

Janelas (editáveis por job em Integrações → Sincronização, só SuperAdmin): padrão D-3 → hoje; fechamento do Ad Manager D-7 → D-4. Modo **incremental** = do dia da última execução com sucesso (−1 dia) até hoje. Primeira importação: `SYNC_BACKFILL_DAYS` (padrão 30) dias.

**Erro numa conta não interrompe as outras**: cada conta Google/Meta e cada rede do Ad Manager roda no seu `try/catch` e fica com o próprio status; o job termina `success` se pelo menos uma deu certo (a mensagem lista as que falharam). Contas **inativas** na plataforma ficam fora (Google: `customer_client.status` ≠ ENABLED · Meta: `account_status` 2/100/101/202), gravado em `integration_accounts.platform_status`.

**Várias redes do Ad Manager (validação estrita):** o worker roda todas as redes importadas. A ligação domínio ↔ rede é **só manual**, em Domínios (`domains.gam_account_id`); o worker nunca faz UPDATE nesse campo. Uma linha do relatório só entra se `domain.gam === rede atual`:
- `SITE` vazio/inválido (normalmente key-values sem dimensão personalizada nesta rede) → ignorada e contada ("N linhas sem site ignoradas (US$ X)");
- site sem rede ligada → ignorada, somada e listada ("N linhas de sites sem rede ligada ignoradas (US$ X): site1, site2…");
- site ligado a outra rede → ignorada, somada e listada ("… ligados a outra rede …").
Os avisos ficam no status da rede (`warn`, "Sincronizado com avisos") em Integrações → Ad Manager → Redes e em Contas. Cada rede só substitui as linhas dos domínios dela.

**Meta: fatiamento e limites.** `level=ad × breakdowns=country × time_increment=1` em janelas longas faz a Meta recusar ("Please reduce the amount of data…") e baixar o limite da conta. O agendador não muda; dentro de `meta.ts` a janela é fatiada em blocos de no máximo `META_CHUNK_DAYS` (3) dias, do mais recente para o mais antigo, cada um paginado à parte, e tudo é unido e gravado de uma vez por conta (se um bloco falhar, nada da conta é trocado e o próximo ciclo tenta de novo).
- Limite de uso (`#4/#17/#32/#613/#80000/#80004`, "too many calls to this ad-account"): pausa `META_RATE_LIMIT_WAIT_MS` (60 s) e repete a mesma página, até `META_RATE_LIMIT_RETRIES` (5) vezes seguidas.
- "Reduce the amount of data" num bloco de vários dias → o bloco vira dias soltos; num dia só → a página cai pela metade (500 → 250 → … → 25).

**Limpeza (`google-ads.cleanup`, `meta.cleanup`):** com "Exclua dados com mais de X dias" ligado, remove de `ads` e `ad_groups` o que o sync não vê há mais de X dias (`last_seen_at`) e sem métrica nesses X dias. Antes de excluir, as linhas de `daily_metrics` desses anúncios/grupos são somadas no nível de cima (anúncio → grupo → campanha), então os totais não mudam.

**Domínio de cada linha (Meta):** 1) domínio do link do criativo; 2) se o criativo não tiver link, o link for de formato não suportado ou apontar para site não cadastrado, o domínio da campanha (o mais comum entre os links dos anúncios dela, ou o que já está gravado); 3) se a campanha também não tiver, o **único** domínio ligado à conta em Domínios (`domain_accounts`; com 2+ não adivinha). Antes de tudo vale o domínio **definido à mão** na campanha (Integrações → Meta Ads → "Campanhas sem domínio", ou o seletor na tela Meta Ads; `campaigns.domain_manual`). Quando nada resolve (ex.: campanha de **mensagens/chatbot**, o link do site vem num botão da conversa), a linha **não é descartada**: vai para o domínio técnico **"Sem domínio"** (`sem-dominio`, só Admin vê). Assim spend e IVA batem com a fatura da Meta e o ROI dos sites não fica inflado. A conta fica `warn` com quantas linhas, quanto custo e cliques e quais campanhas. Ao definir o domínio de uma campanha, as linhas já gravadas mudam de domínio na hora e a janela do `meta.metrics` é ressincronizada (traz o que ficou de fora antes da 0.9). As outras contas seguem normalmente.
**Google Ads:** o mais comum entre as URLs finais dos anúncios da campanha; senão o domínio único da conta.

**Atribuição da receita (Ad Manager):** o site manda no GPT `googletag.pubads().setTargeting('utm_campaign', …)` e `('utm_content', …)` com os valores da URL.
No Ad Manager esses keys precisam estar como **dimensão personalizada** (Inventário → Key-values → "Report on values"). O worker procura os keys pelo nome (`GAM_KEY_CAMPAIGN`, `GAM_KEY_CONTENT`, `GAM_KEY_SOURCE`, `GAM_KEY_PATH` opcional) e:
- campanha encontrada → receita na campanha (e no conjunto/grupo e anúncio, se `utm_content` = `{grupo}_{anúncio}` bater);
- sem valor, macro não substituída, campanha inexistente ou key não configurado → receita **não atribuída** com o motivo (Attribution Health);
- site que não está cadastrado → domínio criado **inativo** ("Visto no Ad Manager"), aparece em Domínios para o admin ativar.

**Placements:** o site também manda o placement do Google Ads para o GPT, lendo da URL do anúncio (o template do Google já tem `placement={placement}`):
```js
const qs = new URLSearchParams(location.search);
googletag.pubads().setTargeting('utm_campaign', qs.get('utm_campaign') || '');
googletag.pubads().setTargeting('utm_content', qs.get('utm_content') || '');
googletag.pubads().setTargeting('utm_source', (qs.get('utm_source') || '').toLowerCase().slice(0, 40)); // push, whatsapp… viram origem na tela URLs
googletag.pubads().setTargeting('page_path', location.pathname.slice(0, 200));                       // a slug da página (tela URLs)
googletag.pubads().setTargeting('placement', (qs.get('placement') || '').toLowerCase().slice(0, 40));
// guarde em sessionStorage na 1ª página para as páginas seguintes da visita também levarem os valores
```
O key `placement` (nome em `GAM_KEY_PLACEMENT`) precisa estar como **dimensão personalizada** no Ad Manager. Sem ele o job `gam.placements` fica `skipped` com o aviso, e a tela mostra só o custo.
Valores de key-value no Ad Manager têm limite de tamanho; para sites o `{placement}` é o host, que cabe.

**URLs (slug) e origem da receita:** a tela URLs mostra a receita por **domínio + slug** (clicar abre a página). O caminho vem, nesta ordem:
1. do key-value `page_path` (`GAM_KEY_PATH`) como dimensão personalizada — o caminho exato;
2. sem ele, da dimensão nativa `URL_NAME` do Ad Manager (Inventário → URL). Parte das redes ainda recusa essa dimensão na API REST: na 1ª recusa a rede é marcada e o sync segue sem URL;
3. sem nenhum dos dois, a receita fica em "(sem URL)" e a rede mostra o aviso de como configurar.
A **origem** vem do `utm_source` (`GAM_KEY_SOURCE`, também como dimensão personalizada) gravado em `daily_metrics.utm_source`: valores de anúncio (google, fb, ig…) ou vazio contam como Google Ads / Meta Ads pela campanha atribuída; qualquer outro valor (push, whatsapp, email…) é **retenção** e aparece como origem própria; o resto é "Sem origem". Guarde os valores em `sessionStorage` na 1ª página para as páginas seguintes da visita.

**Meta: Resultados, Leads e cliques no link:** o insights pede `actions`; `link_click` → Cliques Meta, `onsite_conversion.messaging_conversation_started_7d` → Resultados, `lead` → Leads (`daily_metrics.meta_link_clicks/meta_results/meta_leads`). CPC-L, CPR e CPL = custo Meta ÷ ação, calculados na consulta.

**Sessões:** o Ad Manager e as plataformas não entregam sessões; RPS e Sessions ficam vazios até existir o tracking próprio do site gravando `daily_metrics.sessions`.

## Checklist para o back-end

1. Criar os apps OAuth (Google Cloud e Meta) e preencher o `.env` (Google Ads: `GOOGLE_ADS_DEVELOPER_TOKEN` e `GOOGLE_ADS_LOGIN_CUSTOMER_ID`).
2. No Ad Manager, deixar `utm_campaign`, `utm_content` e `placement` como dimensão personalizada e conferir se o site manda esses key-values no GPT.
3. Configurar SMTP para os convites.
4. Novas rotas: devolver os tipos de `src/types/api.ts`, erros `{ "error": { "code", "message" } }`, sempre com `scope()`.
