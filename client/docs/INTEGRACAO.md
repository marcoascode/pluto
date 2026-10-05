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

## Squads e permissões (obrigatório no servidor)

`server/src/auth/scope.ts` resolve os domínios permitidos e **toda** rota de métricas passa por ele:

```ts
// Admin/SuperAdmin: todos os domínios ativos · Gestor: só os do Squad dele
const rows = await q(`SELECT d.id, d.hostname FROM squad_users su
                        JOIN squad_domains sd ON sd.squad_id = su.squad_id
                        JOIN domains d ON d.id = sd.domain_id AND d.active
                       WHERE su.user_id = $1`, [user.id]);
// ?domain= fora da lista → 403 forbidden_domain
// e sempre: WHERE m.domain_id = ANY($4::bigint[])
```

Módulos (Relatórios, URLs, Google, Meta, Ad Manager, Atribuição, UTM Debugger) podem ser desligados para o Gestor em
**Usuários & Squads → Permissões** (`role_permissions`); o servidor responde `403 forbidden_module`. `/admin/*` é só Admin e SuperAdmin; conectar integrações e mudar a frequência do sync é só SuperAdmin.

## PostgreSQL

- Esquema em `server/migrations/001_init.sql` (aplicado sozinho no boot, controlado por `schema_migrations`). Nova mudança = novo arquivo `002_…sql`.
- Biblioteca `pg` com pool (`server/src/db.ts`) e **sempre** placeholders `$1, $2…` (nada de concatenar SQL).
- Dinheiro em `NUMERIC(14,4)`, sempre em USD na tabela. Na consulta, cada linha é convertida pela taxa **do próprio dia** (`currency_rates`) antes de somar.
- Datas em `DATE` no timezone da organização (`APP_TZ`).
- Fatos em `daily_metrics` (dia × domínio × URL × campanha/grupo/anúncio × país). Receita sem UTM válida fica com `platform = 'none'` + `unattributed_reason` e sai como `unattributedRevenue` — nunca rateada entre campanhas.
- Tokens OAuth (Google Ads, Meta, GAM) criptografados com AES-256-GCM; a chave fica em `TOKEN_ENC_KEY`, fora do banco.

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

Janelas: métricas D-3 → hoje; fechamento do Ad Manager D-7 → D-4. Primeira importação: `SYNC_BACKFILL_DAYS` (padrão 30) dias.

**Domínio de cada campanha:** o mais comum entre os links dos anúncios dela (Meta: link do criativo · Google: URL final). Se não der, usa o domínio ligado à conta em Domínios (quando for um só). Sem domínio, a linha não entra e a conta mostra o aviso.

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
googletag.pubads().setTargeting('placement', (qs.get('placement') || '').toLowerCase().slice(0, 40));
// guarde em sessionStorage na 1ª página para as páginas seguintes da visita também levarem os valores
```
O key `placement` (nome em `GAM_KEY_PLACEMENT`) precisa estar como **dimensão personalizada** no Ad Manager. Sem ele o job `gam.placements` fica `skipped` com o aviso, e a tela mostra só o custo.
Valores de key-value no Ad Manager têm limite de tamanho; para sites o `{placement}` é o host, que cabe.

**Sessões:** o Ad Manager e as plataformas não entregam sessões; RPS e Sessions ficam vazios até existir o tracking próprio do site gravando `daily_metrics.sessions`.

## Checklist para o back-end

1. Criar os apps OAuth (Google Cloud e Meta) e preencher o `.env` (Google Ads: `GOOGLE_ADS_DEVELOPER_TOKEN` e `GOOGLE_ADS_LOGIN_CUSTOMER_ID`).
2. No Ad Manager, deixar `utm_campaign`, `utm_content` e `placement` como dimensão personalizada e conferir se o site manda esses key-values no GPT.
3. Configurar SMTP para os convites.
4. Novas rotas: devolver os tipos de `src/types/api.ts`, erros `{ "error": { "code", "message" } }`, sempre com `scope()`.
