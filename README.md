# Pluto Mídia

Dashboard de compra de mídia (Google Ads + Meta Ads) × monetização (Google Ad Manager).

| Pasta | O que é | Stack |
|---|---|---|
| `client/` | Frontend | React 19 · Vite · TypeScript · MUI 9 · TanStack Query |
| `server/` | API | Node.js 22 · Express 5 · TypeScript · `pg` (PostgreSQL 16) · argon2id |
| `deploy/` | Nginx principal do servidor | bloco 443 → web (8400) e api (4000) |
| `docker-compose.yml` | Produção | web `127.0.0.1:8400:80` · api `127.0.0.1:4000:4000` · db `127.0.0.1:54321:5432` |

- **Subir no servidor:** `docs/DEPLOY.md`
- **Contrato da API:** `client/docs/API.md` (tipos em `client/src/types/api.ts`)
- **Integração e regras (sessão, Squads, câmbio, sync):** `client/docs/INTEGRACAO.md`
- **Banco:** `server/migrations/` (`001_init.sql`, `002_superadmin_iva_revshare.sql`, `003_placements.sql`, `004_empresas_gerente_vinculos.sql`)
- **Demonstração** (o próprio front em um arquivo só, com dados de exemplo, sem servidor): `docs/demo/pluto-dash-demo.html`

## Rodar local

```bash
docker run -d --name pluto-db -e POSTGRES_USER=pluto -e POSTGRES_PASSWORD=pluto -e POSTGRES_DB=pluto -p 54321:5432 postgres:16-alpine
cd server && cp .env.example .env && npm install && npm run dev     # API :4000
cd client && cp .env.example .env && npm install && npm run dev     # front :5173
# só o front, com dados de exemplo: cd client && npm run dev:mock
```

## O que já funciona no servidor

- Login com sessão em cookie httpOnly, troca e redefinição de senha, convite por e-mail.
- CRUD de Usuários, Squads, Permissões (por papel), Domínios e Contas (Google Ads, Meta Ads, Ad Manager) + frequência de cada sincronização.
- Filtro de Squad e permissões aplicado em toda rota (403 fora do escopo).
- Todas as telas de métricas lendo `daily_metrics` (dashboard, domínios, campanhas, países, URLs com drop-off, Ad Manager, relatórios dia/mês, atribuição, busca, UTM Debugger).
- Câmbio real USD/BRL/EUR (Frankfurter, sem chave) com histórico e taxa por dia.
- OAuth do Google (Ads e Ad Manager) e da Meta: início, callback, tokens criptografados, descoberta de contas Meta e redes GAM.
- **Workers de sincronização** (`server/src/services/sync/`): Meta (`meta.ts`), Google Ads (`googleAds.ts`) e Ad Manager (`gam.ts`) → `daily_metrics`, idempotentes, com conversão para USD pela taxa do dia.
- **IVA** de 13,83% sobre o spend da Meta, somado às despesas (Spend = Google + Meta + IVA) e exibido como despesa nos relatórios. Alíquota em `app_settings.meta_iva_rate`.
- **revShare por domínio** (participação da Network) com data de vigência: Revenue exibida = bruta − bruta × revShare. Não aparece nos relatórios.
- **Placements** (Campanhas → Placements): domínio → contas → campanhas, custo do Google Ads por placement × receita do Ad Manager, subdomínios agrupados no domínio principal, ranking de ROI e campanhas por placement.
- ROI e ROI D-1/D-2/D-3 sempre na ponta direita das tabelas; métricas adicionais entram à esquerda.
- **Empresas** (sociedades): seletor "Empresa" no topo filtra o painel inteiro; painel da Empresa em `/empresas/:id` (sócios, Squads, domínios, gestores e números).
- Vínculo **domínio + gestor(es) + contas Google/Meta**: o Gestor vê só as campanhas das contas dele em cada domínio. Papel **Gerente** (vários Squads, sem administração).
- **Deságio** do USD/BRL na receita do Ad Manager; **janela editável** e **limpeza** de grupos/anúncios antigos no sync; sync segue nas outras contas quando uma falha; várias redes do Ad Manager.
- Papéis **Gestor**, **Gerente**, **Admin** (antigo "Acesso Total": todo o CRUD, inclusive contas) e **SuperAdmin** (único que conecta integrações e muda a frequência do sync).

## O que falta

- **Google Ads:** preencher `GOOGLE_ADS_DEVELOPER_TOKEN` e `GOOGLE_ADS_LOGIN_CUSTOMER_ID` quando a API for liberada (o worker já está pronto; até lá fica `skipped`).
- **Placements:** o site precisa mandar o key-value `placement` no GPT (ver `client/docs/INTEGRACAO.md`).
- **Sessões / RPS:** não vêm de nenhuma das APIs; dependem de um tracking no próprio site.

******
**VERIFICAR APROVAÇÃO DE ESCOPO PARA GOOGLE ADS API**
https://console.cloud.google.com/auth/scopes?inv=1&invt=Ab4LDg&project=api-do-ad-manager

## DEPLOY
cd /var/www/pluto
sudo git pull
sudo docker compose down --remove-orphans
sudo docker compose build --no-cache
sudo docker compose up -d --build
sudo docker exec nginx nginx -t
sudo docker exec nginx nginx -s reload
sudo sh -c 'truncate -s 0 /var/lib/docker/containers/*/*-json.log'
sudo docker builder prune -a -f
sudo docker image prune -a -f

## REINICIAR CONTAINER
docker compose up -d --force-recreate api