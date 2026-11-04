# Pluto Mídia · 0.14.0 — o que mudou desde o deploy 0.10.0

Projeto completo. Para subir: `git pull` (ou copiar a pasta) → `docker compose up -d --build`. As migrations 007, 008 e 009 rodam
sozinhas no boot da api. Depois, no servidor, atualize o Nginx do host com `deploy/nginx-host.conf` e rode
`sudo nginx -t && sudo systemctl reload nginx` (libera 11 MB só na rota de envio de comprovante). Detalhes em `docs/DEPLOY.md`.

## Integrações → Meta Ads · Campanhas sem domínio
`client/src/pages/admin/UnmappedCampaignsCard.tsx`: 20 linhas por página, filtro por conta de anúncio (com a contagem de cada conta)
e busca por nome ou ID da campanha (ignora maiúsculas e acentos). A lista continua vindo numa chamada só; a tela renderiza só a
página atual, então centenas de campanhas não pesam mais. Ao salvar o domínio de uma campanha, a página se ajusta sozinha.

## Finance (Caixa Empresa, Custos, Comissões)
- Caixa 100% manual: receita recebida / gasto pago com **site** e **mês de referência**; na receita, "o valor já tem o revshare
  descontado?" — se não, o dash desconta o % do domínio (Admin → Domínios, ou 7,5%) e lança o líquido.
- Comprovantes (link do Google Drive ou PDF/JPG/PNG até 10 MB) com nº, data e valor da NF em lançamentos e custos.
- Custos: mudança de plano a partir de um mês e valor real de cada mês pela NF; custo pode ser de um site só.
- **Comissões** (`/finance/comissoes`): filtros Empresa · Gestor · Mês; regra Meritocracia (sem lucro sem comissão; até US$ 20 mil 10%,
  acima 12%, a partir de US$ 40 mil 15%); site negativo desconta; aprovar e marcar como paga (pagamento por fora, não entra no Caixa);
  vínculos gestor × site com histórico e rateio. Gestor vê só os próprios sites.
- Arquivos: `server/migrations/007–009`, `server/src/services/finance*.ts`, `server/src/routes/finance*.ts`,
  `client/src/lib/finance*.ts`, `client/src/pages/finance/*`, `client/src/mocks/finance*.ts`, menu e rota em `App.tsx`,
  `components/layout/nav.tsx` e `Sidebar.tsx`.

## UTM do dash antigo
`utm_campaign={creative}&utm_content={creative}_{placement}` passa a ser atribuído no dash novo pelo ID do anúncio do Google Ads
(os dois dashes funcionam juntos). O placement do utm_content vai para Placements; o UTM Debugger e a tela Attribution / UTMs
mostram o formato. Arquivos: `server/src/services/sync/gam.ts`, `placements.ts`, `server/src/routes/metrics.ts`,
`client/src/pages/admin/Utms.tsx`. Para trazer mais histórico do Ad Manager: aumente `SYNC_BACKFILL_DAYS` e rode o sync.

## Verificado
`tsc` do client e do server sem erros; `npm run build` e `npm run build:demo` ok (demo atualizada em `docs/demo/`);
migrations 001→009 em banco limpo; 103 checagens do Finance contra Postgres; atribuição testada nos dois formatos de UTM;
tabela de campanhas sem domínio testada com 120 linhas (paginação, filtro por conta e busca por nome/ID).
Ainda não testado com dados reais do Ad Manager e não validado com `nginx -t` (fazer no servidor ao recarregar).
