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
- **Banco:** `server/migrations/001_init.sql`

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

## O que falta

- Os **workers** que baixam os dados de Google Ads, Meta e Ad Manager para `daily_metrics` (`server/src/services/sync/index.ts` tem a interface e as consultas indicadas). Até lá os jobs ficam como `skipped` e as telas mostram zero.

## DEPLOY

cd /var/www/dash-chatpluto
sudo git pull
sudo docker compose down --remove-orphans
sudo docker compose build --no-cache
sudo docker compose up -d --build
sudo docker exec nginx nginx -t
sudo docker exec nginx nginx -s reload
sudo sh -c 'truncate -s 0 /var/lib/docker/containers/*/*-json.log'
sudo docker builder prune -a -f
sudo docker image prune -a -f