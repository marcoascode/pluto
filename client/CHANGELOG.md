# Changelog

## 0.18.15
- **Fluxo de caixa (Etapa 2 · cartões e lançamentos)**: a tela `/fluxo-caixa` passa a funcionar com lançamentos manuais, organizados pelo **mês da data da compra**. Cada lançamento tem data, descrição, valor (R$), cartão, tipo (compra, estorno/crédito, tarifa/anuidade, IOF, juros/encargos, pagamento da fatura), parcela "n de N", valor/moeda originais (compras no exterior), categoria e observação.
- Totais do mês: despesas, estornos/créditos, líquido e pagamentos de fatura — que ficam **fora da soma** para o mesmo gasto não contar duas vezes. Qualquer lançamento pode sair das somas sem ser apagado. Faixa com os últimos 12 meses (clique para abrir o mês) e filtro por cartão.
- **Cartões**: cadastro de emissor, apelido e só os 4 últimos dígitos (nunca o número completo). Excluir um cartão mantém os lançamentos dele como "sem cartão".
- **Origem** de cada lançamento calculada a partir da descrição (ex.: "FACEBK *2X8Y…" e "FACEBK *K7QW…" → `FACEBK`; intermediadores como `PAG*`, `MP*`, `PG *` usam o que vem depois do `*`; parcela e códigos saem). É a base da soma mensal por origem, que chega numa próxima etapa.
- Tudo por usuário: cada um vê só os próprios cartões e lançamentos. Rotas `GET/POST/PUT/DELETE /cashflow/cards`, `/cashflow/entries` e `GET /cashflow/months`; migration `026` cria `cashflow_cards` e `cashflow_entries`.

## 0.18.14
- **Fluxo de caixa (Etapa 1 · permissão)**: novo módulo **Fluxo de caixa**, por usuário (cada um vê só os próprios dados), que vai receber faturas de cartão de crédito em PDF, gerar lançamentos (data da compra, descrição, valor) e somar por mês as despesas da mesma origem vindas de faturas diferentes (ex.: "FACEBK *…" = campanhas no Facebook).
- Assim como a criação automatizada de campanhas Meta, o módulo é liberado **só pelo SuperAdmin**, usuário a usuário: nova coluna **Fluxo de caixa** em Usuários & Squads (rota `PUT /admin/users/:id/cashflow`; Admin recebe 403). Migration `025` adiciona `can_use_cashflow`, `cashflow_granted_by` e `cashflow_granted_at` em `users`.
- Menu lateral: grupo **Fluxo de caixa** (`/fluxo-caixa`), visível só para quem tem a permissão. O servidor também bloqueia `/cashflow/*` com 403 (`cashflow_disabled`).

## 0.18.13
- **Dados de recebimento da comissão**: novo item **Dados de recebimento** no menu do usuário (avatar, canto superior direito). Cada usuário edita o próprio cadastro escolhendo o meio de recebimento — **Chave PIX**, **Dolafy** ou **Outro (especificar)** — e a identificação para recebimento (a chave PIX, o @ Dolafy ou outro dado). Rotas `GET/PUT /me/payout`; migration `024` adiciona `payout_method`, `payout_method_other` e `payout_key` em `users`.
- **Comissões** (`/finance/comissoes`): o card de cada gestor mostra, em destaque numa linha acima do botão Aprovar, o meio e a identificação (ex.: "Chave PIX: 123.456.789-01"), com botão para copiar. Sem dados informados, o card avisa "Meio de recebimento não informado".

## 0.18.12
- **Usuários visíveis ao Admin**: o Admin vê (e edita, exclui, reenvia convite, atribui domínios) só ele mesmo, os usuários que **ele cadastrou** e os que pertencem a um **Squad das Empresas em que é sócio** (Gerente do Squad, gestor de domínio do Squad ou sócio da Empresa). Vale também para a lista de gestores, sócios das Empresas e "Gestores e sites". SuperAdmin continua vendo todos. Migration `023` grava quem cadastrou cada usuário a partir de agora (usuários antigos ficam sem autor).
- **Menu lateral reorganizado**: Dashboard, Relatórios · **Campanhas** (Google Ads, Placements, Meta Ads, Perfis & BMs, Criar campanhas Meta) · **Domínios** (Domínios / Sites, Contas × Sites, URLs) · **Monetização** (Google Ad Manager) · **Atribuição** (Diagnóstico da atribuição, UTM Debugger) · **Administração** → Finanças (Caixa Empresa, Custos, Comissões), Relatórios (Google Ads, Meta Ads, Google Ad Manager), Integrações (Google Ads, Meta Ads, Google Ad Manager), Configurações (Contas, Domínios, Usuários & Squads, Atribuição / UTMs, Moedas).
- A seção Finance saiu do menu e virou o grupo **Finanças** dentro de Administração (sócios veem só Finanças; o gestor, só Comissões).
- Renomes: "Attribution Health" → **Diagnóstico da atribuição**; "Attribution / UTMs" → **Atribuição / UTMs** (menu e título das telas).

## 0.18.11
- **Permissão Admin restrita às Empresas em que é sócio**: antes o Admin via todos os domínios (igual ao SuperAdmin). Agora vê e edita só os domínios dos Squads das Empresas das quais é sócio, em todo o painel: Dashboard, Relatórios, URLs, campanhas, seletor "Empresa", Finance (Caixa, Custos, Comissões), Administração → Domínios, Squads, Empresas, Relatórios por conta, Campanhas sem domínio e Contas × Sites. O domínio técnico "Sem domínio" fica só para o SuperAdmin. O servidor confere tudo (403 fora do alcance).
- **Usuários & Squads (Admin)**: vincula gestores, Gerentes (Squads) e sócios só dentro das Empresas dele; vínculos do usuário em outras Empresas ficam como estão e não aparecem. Não pode se tirar da própria sociedade.
- **Empresas**: o Admin edita só as Empresas em que é sócio (e só com Squads delas); criar e excluir Empresa passa a ser só do SuperAdmin.
- **Domínios e Squads**: o Admin cadastra domínio já escolhendo um Squad das Empresas dele e não deixa domínio sem Squad nem Squad sem Empresa (senão sairia do alcance dele).
- SuperAdmin continua vendo e editando tudo.

## 0.18.10
- **Comissão progressiva no cadastro do gestor**: as faixas saíram do painel de Comissões (card "Comissão progressiva" e rota `PUT /finance/commission-rule` removidos) e passam a ser definidas por gestor em Usuários & Squads → editar gestor, no campo que aparece ao escolher a modalidade **Progressiva** (patamares, %, moeda, "+ Faixa" e "Restaurar padrão"), do mesmo jeito que a % da **Fixa**.
- **Padrões**: Progressiva = ROI até US$ 19.999,99 → 10% · US$ 20.000,00 a 39.999,99 → 12% · a partir de US$ 40.000,00 → 15%. Fixa = 10%.
- Migration `022`: gestores que já estavam na progressiva recebem as faixas que valiam no painel. Comissões já aprovadas mantêm a % gravada na aprovação.
- Painel de Comissões: cada card de gestor mostra as faixas dele (progressiva) ou a % (fixa).

## 0.18.9
- **"Gestores e sites" de volta, na edição do gestor** (Usuários & Squads → editar gestor → botão **Gestores e sites**): períodos por site com início, fim (opcional), rateio e observação, como antes. Nos dias que um período cobre, ele vale no lugar do Rateio do domínio; trocar o responsável continua sendo "data de fim + período novo" (meses anteriores não mudam, e período com comissão aprovada fica travado).
- **Rateio na edição de domínio** (`/admin/dominios`): aparece quando o domínio tem mais de um gestor. Dá para definir a % da receita de cada gestor (a soma precisa ser 100%; conferido na tela e no servidor) ou voltar para "dividir igualmente". Cada gestor continua descontando só as despesas das próprias contas. Quando entra ou sai um gestor do domínio, o rateio volta para partes iguais até ser definido de novo (migration `021`).
- **Comissões dia a dia**: em cada dia, a receita do site vai para os gestores dos períodos de "Gestores e sites" que cobrem o dia ou, sem período, para os gestores do domínio pelo Rateio; as despesas de cada gestor são as das contas dele nos dias em que responde pelo site. Os cards mostram a origem (rateio, período ou os dois) e avisam quando o rateio não está definido.
- **Gerente volta a atribuir domínios e contas aos gestores**: menu **Domínios → Gestores** (`/admin/usuarios`, visão do Gerente) lista os gestores do alcance dele e permite ligar domínios dos Squads/Empresas dele e as contas Google Ads / Meta Ads de cada um. O que estiver fora do alcance fica como está. O vínculo continua sendo o de Usuários & Squads (mesma regra de despesa e de comissão).

## 0.18.8
- **Vínculos só em Usuários & Squads**: usuário × domínio × contas Google Ads / Meta Ads passam a ser criados **exclusivamente** em Configurações → Usuários & Squads → aba Usuários (editar o gestor → Domínios). Saíram a atribuição de contas na edição de domínios (`/admin/dominios`), a de domínios na edição de contas Meta Ads e Google Ads (`/admin/integracoes/…`) e, em **Contas × Sites** (`/vinculos`), o botão Vincular e a aba "Atribuição aos gestores" (a tela fica só para consulta e correção da data de uma mudança). As telas continuam mostrando os vínculos (gestores e contas no domínio, domínios na conta).
- O site em que o sync põe a despesa de cada conta (`domain_accounts`) passa a ser derivado desses vínculos (conta → domínios em que algum gestor a usa), com histórico a partir do dia da mudança; a migration `020` reconcilia os vínculos atuais a partir de hoje (dias anteriores não mudam).
- **Comissões por ROI do gestor**: ROI = receita líquida dos sites que o gestor administra (a mesma da Home, em R$ pela cotação do ROI; dividida igualmente se o site tiver mais de um gestor) − despesas Google + Meta + IVA **só das contas vinculadas a ele** naquele site. Site negativo desconta. A % é aplicada ao ROI total do mês (sem ROI positivo, sem comissão). Saíram do cálculo os outros gastos do Caixa e os custos do site, e o diálogo "Gestores e sites" (o gestor vem só de Usuários & Squads).
- **Modalidade de comissão no cadastro do gestor** (Admin/SuperAdmin): **Progressiva** (faixas de ROI) ou **Fixa** (campo de % que aparece ao escolher Fixa).
- **Card "Comissão progressiva"** no painel de Comissões: mostra os patamares e o Admin edita faixas, % e moeda ali mesmo. Padrão: ROI até US$ 19.999,99 → 10% · US$ 20.000,00 a 39.999,99 → 12% · a partir de US$ 40.000,00 → 15%.
- Cards dos gestores mostram ROI total em R$ e US$, modalidade, % aplicada e comissão (R$ e ≈ US$). Fluxo do mês encerrado mantido: conferir → aprovar → marcar como paga (pagamento por fora; o painel só registra).

## 0.18.7
- **ROI conferido em todos os relatórios**: ROI (R$) = ((Receita − Receita × revShare) × cotação c/ deságio) − Despesas Google Ads − Despesas Meta Ads − IVA (mês com cotação travada usa a travada). Textos de ajuda e rodapé de Relatórios mostram a fórmula completa.
- **Placements**: corrigido o ROI das linhas de subdomínio com receita estimada (distribuída a partir do domínio principal), que subtraía a despesa em R$ da receita em US$ sem converter.

## 0.18.6
- **Moedas sem conversão nos relatórios**: receita (Google Ad Manager) fica sempre em **US$** e despesas (Google Ads + Meta Ads + IVA da Meta) sempre em **R$**, em todas as telas, para "Todos os domínios" e para domínio específico. O sync passou a gravar o custo das contas em BRL (moeda em que pagam; migration `019` converte o histórico gravado em USD pela mesma taxa do dia e renomeia `spend_usd`/`iva_usd` → `spend_brl`/`iva_brl`).
- **ROI com a cotação só no cálculo**: ROI (R$) = Receita (US$) × cotação USD/BRL − Despesas (R$). ROI %, Margem e o resultado por site do Finance usam o mesmo cálculo. Saiu o seletor de moeda do topo (USD/BRL/EUR); ficou só a cotação atual "USD/BRL c/ deságio".
- **Travar cotação** (Relatórios → Resultados mensais, coluna Cotação, só Admin/SuperAdmin): grava a cotação do câmbio do mês (`fx_month_locks`), que passa a valer para o ROI daquele mês e não flutua mais. Meses sem trava usam a cotação atual c/ deságio.
- **Integrações → Meta Ads**: card "Campanhas sem domínio" movido para o fim da página, abaixo de Sincronização.
- **Administração → Relatórios** (só Admin/SuperAdmin): Meta Ads, Google Ads e Google Ad Manager com as métricas de todas as contas conectadas. **Por conta** (escolha as contas; linhas data × conta) ou **Por período** (todas as contas com o total do período). Usa a Data do topo e exporta CSV.

## 0.18.5
- **Criação de campanhas Meta · Etapa 3 (Configuração)**: novo bloco **Posicionamentos** do Conjunto de Anúncios. Padrão: automáticos (Advantage+). Em **Manuais**, dá para marcar/desmarcar plataformas inteiras (Facebook, Instagram, Audience Network, Messenger), cada posição (Feed, Stories, Reels, Explorar, Marketplace, Coluna da direita…) e os dispositivos (celular/computador). A seleção vai para `targeting.publisher_platforms`, `<plataforma>_positions` e `device_platforms`, é salva nas campanhas pendentes e aparece no resumo da revisão.
- Validação no assistente e no servidor: ao menos um posicionamento e um dispositivo; Audience Network e Messenger só junto com o Facebook; posição só para plataforma escolhida.

## 0.18.4
- **Sidebar**: a versão do painel saiu do rodapé e foi para o topo, ao lado de "Media Intelligence" (`Media Intelligence · v0.18.4`); com o menu recolhido, aparece no tooltip do logo.
- **Criação de campanhas Meta**: Conjuntos e anúncios recebem numeração no início do nome: `(Cj.1) <campanha>` e `(Cj.1 / Ad.N) <campanha>`. A contagem de anúncios é contínua entre Conjuntos.

## 0.18.2
- **Perfis do Facebook via OAuth** (substitui o System User Token manual): botão **Conectar Perfil do Facebook** abre o Facebook Login (`auth_type=rerequest`; "Reconectar / Renovar" usa `reauthenticate`). O servidor troca o `code` por um **Long-Lived User Access Token (~60 dias)**, confere `/me` e `/me/permissions` (6 escopos: `ads_management`, `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`, `public_profile`), salva o token criptografado com a data de expiração e sincroniza BMs, contas de anúncios, Páginas e Pixels/Datasets.
- **Contingência multi-perfil**: cada gestor conecta quantos Perfis quiser (um por login do Facebook); cards com status do token, dias restantes, contagem de ativos, **Sincronizar Ativos** (`POST /meta/profiles/:id/sync`) e **Remover Perfil**.
- **Wizard** passa a ler só os ativos sincronizados de cada Perfil (contas, Páginas, Pixels/Datasets); Perfis vencidos, recusados ou sem permissões ficam desabilitados.
- Perfis antigos (System User Token) continuam funcionando, marcados como "legado". Rotas removidas: `POST /meta/profiles`, `PATCH /meta/profiles/:id`, `POST /meta/profiles/check-token`, `POST /meta/profiles/:id/validate`.

## 0.18.1
- **Perfis & BMs**: guia passo a passo retrátil para gerar o System User Token (com cópia do ID do App) e validação real das 5 permissões obrigatórias (`ads_management`, `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`) via `/debug_token`. Token incompleto ou recusado não é salvo e o formulário lista as permissões que faltam.

## 0.18.0
- **Criação automatizada de campanhas Meta**: assistente em 4 passos (`/criar-campanha-meta`) com site/Perfil/conta/Página, upload múltiplo de criativos (preview local; as imagens trafegam em memória até a Meta), copies geradas pela IA, modo manual ou otimização por histórico, Dataset/Evento do Pixel, prévia da URL com UTMs e disparo em lote com progresso por campanha.
- **Perfis & BMs** (`/perfis-meta`): cadastro do System User Token (criptografado no servidor), revalidação e sincronização das Páginas.
- **Governança**: a flag `can_create_meta_campaigns` é liberada só pelo SuperAdmin (Usuários & Squads); sem ela, menu e rotas ficam ocultos e o servidor responde 403.

## 0.17.1
- **Retenção por site**: o utm_source (push/WhatsApp) não é mais repartido entre os sites da rede quando o Ad Manager só entrega o total da rede; bloco de anúncios → site quando a rede recusa Key-values com SITE; Key-values aprimorados aceitos key a key (basta utm_source marcado).

## 0.17.0
- **Domínios**: Registro (onde foi comprado), Vencimento (alerta em 30 dias e vencido), Hospedagem, Usuário WP e Senha WP (criptografada; "Mostrar senha" registra quem abriu; só Admin/SuperAdmin).
- **Contas × Sites** (`/vinculos`): a despesa da conta segue o vínculo de cada dia. Até a data da mudança fica no site antigo; a partir dela, no novo. Data editável só por Gerente/Admin/SuperAdmin; histórico com editar/excluir.
- **Gestores**: Gerente/Admin/SuperAdmin atribuem domínios e contas Google/Meta; o gestor só vê e só liga as contas dele aos domínios dele (sempre a partir de hoje). Restrição também no servidor.

## 0.10.0
- **Métricas (Prompt-06)**:
  - Meta: Impressões Meta, Cliques Meta (`link_click`), CPC-L, Resultados (`onsite_conversion.messaging_conversation_started_7d`), CPR, Leads (`lead`), CPL; o sync pede `actions` no insights (`meta.ts`), em colunas novas de `daily_metrics`;
  - Ad Manager: CPC ADX; RPS = Receita ÷ Sessões e RPM de Sessão = RPS × 1000 (o RPS antigo, ×1000, agora é o RPM de Sessão);
  - "Selecionar métricas" separado em **Resultados / Despesas / Receitas** (`ListSubheader`), colunas sempre nessa ordem; Relatórios e URLs com cabeçalho dos 3 blocos;
  - renomes: Revenue → Receita, Spend → Despesas, Profit → ROI, ROI → ROI %, Não atribuída → RNA, Sessions → Sessões.
- **URLs**: a slug vem do Ad Manager (key-value `page_path`, padrão novo de `GAM_KEY_PATH`; sem ele, dimensão `URL_NAME` com recuo automático) e **abre a página** (domínio/slug) numa aba nova. Aviso na tela e na rede quando a receita está em "(sem URL)".
- **Origem da receita (utm_source)**: cartão na tela URLs com Google Ads, Meta Ads, cada utm_source de retenção (push, whatsapp, email…) e Sem origem, com receita, % e custo/ROI; clicar filtra as URLs. `daily_metrics.utm_source` entra no grão da linha.
- **Finance** (menu novo, Admin e sócios das Empresas):
  - **Caixa Empresa**: caixa estimado hoje (saldo conferido + resultado − custos pagos + aportes − retiradas), mês atual parcial e **fechamento mensal** (mês anterior + atual por padrão; 3, 6, 12 meses, ano ou De/Até) com Receita × Google × Meta × IVA × Custos, resultado e margem, quebra por categoria e por Empresa;
  - **Custos**: custos mensais (com início/fim) e avulsos por Empresa — ferramentas, domínios, hospedagem, equipe/salários, impostos, serviços, outros — em BRL/USD/EUR com dia de pagamento.
  - `migrations/006_metricas_meta_finance.sql`, `routes/finance.ts`, `services/finance.ts`, `pages/finance/*`.

## 0.9.0
- **Domínio técnico "Sem domínio"** (`migrations/005_dominio_tecnico_mapeamento.sql`, hostname `sem-dominio`): o custo de campanhas Meta sem domínio identificável (ex.: mensagens/chatbot) é gravado nele em vez de descartado. Spend e IVA batem com a fatura e o ROI dos sites não fica inflado. Só Admin/SuperAdmin veem (`scope.ts`); não entra em Squad, gestor, conta nem Ad Manager (rotas + triggers no banco); não se edita nem exclui.
- **Mapeamento manual campanha → domínio**:
  - `GET /admin/campaigns/unmapped` (as campanhas do aviso "linhas sem domínio") e `PATCH /admin/campaigns/:id { domain }`;
  - o domínio manual vale sobre o link dos anúncios e o sync não troca (`campaigns.domain_manual`, `domain_set_by`, `domain_set_at`);
  - ao salvar: as linhas já gravadas da campanha mudam de domínio na hora (transação, somando no mesmo grão) e o job `meta.metrics` (ou `google-ads.metrics`) roda em segundo plano; se já estiver rodando, roda de novo ao terminar (`requestRun`).
- **Telas**: cartão "Campanhas sem domínio" com seletor em Integrações → Meta Ads; na lista de campanhas (Meta Ads), a campanha sem domínio mostra o seletor no lugar do domínio; "Sem domínio" aparece no Dashboard/Domínios do Admin e como linha de sistema em Domínios.
- Aviso da conta Meta: "N linhas sem domínio gravadas em "Sem domínio" (US$ …) em … Defina o domínio dessas campanhas…".

## 0.8.0
- **Meta Ads (`server/src/services/sync/meta.ts`)**:
  - **chunking**: a janela `w.from → w.to` é fatiada em blocos de no máximo 3 dias (`META_CHUNK_DAYS`), do mais recente ao mais antigo; cada bloco é paginado à parte e os resultados são unidos e gravados uma vez por conta. O agendador (`index.ts`) não mudou;
  - **limite de uso** (#17, #80004 "too many calls"…): pausa 60 s (`META_RATE_LIMIT_WAIT_MS`) e repete, até 5× (`META_RATE_LIMIT_RETRIES`). Vale também para a estrutura e para a leitura da conta;
  - **"Please reduce the amount of data"**: o bloco vira dias soltos; num dia só, a página cai pela metade (500 → 25). `http.ts` não repete esse erro às cegas (`too_much_data`);
  - **domínio de cada linha**: link do criativo → domínio da campanha → domínio único da conta (`domain_accounts`). Só sem nenhum dos três a linha fica de fora, e a conta mostra quantas linhas, quanto custo e cliques e quais campanhas.
- **Ad Manager (`gam.ts`, `placements.ts`)**: **fim do `claimGam`**. O domínio só recebe receita da rede ligada a ele em Domínios (`domain.gam === net.id`), sem UPDATE automático. Linhas sem site, de site sem rede e de site de outra rede são ignoradas, somadas (linhas e US$) e listadas por site no status da rede.
- **Status `warn` ("Sincronizado com avisos")**: conta/rede que sincronizou mas descartou linhas. Aparece em Contas (Google, Meta e agora as redes do Ad Manager) e nas tabelas de contas das integrações. `/admin/integrations` devolve `gam.accounts`.
- **Atenção na atualização**: domínios que ainda não têm rede do Ad Manager (`gam_account_id` nulo) param de receber receita até o admin ligar cada um em Domínios. Os que o `claimGam` já tinha ligado continuam como estão.

## 0.7.0
- **Empresas**: seletor "Empresa" ao lado da Moeda (`components/filters/CompanyPicker.tsx`). Cada Empresa mostra sócios, Squads e domínios; escolher filtra o painel inteiro (`?company=` em toda chamada, guardado no navegador). "Abrir painel" leva para **`/empresas/:id`** (`pages/CompanyOverview.tsx`): sócios, KPIs, gráficos e Squads → domínios → gestores.
- **Usuários & Squads** (`pages/admin/UsersSquads.tsx`):
  - papel **Gerente** (vê vários Squads, sem administração);
  - Gestor com **domínio(s) + contas Google Ads + contas Meta Ads** em cada domínio (vê só essas campanhas);
  - "Sócio das Empresas" para qualquer papel;
  - nova aba **Empresas** (nome, sócios, Squads); Squad ganha Empresa;
  - Permissões com coluna Gerente.
- **Domínios**: conta do Ad Manager (uma por domínio) e lista de gestores com as contas de cada um.
- **Moedas**: **deságio** (R$) com histórico — a receita do Ad Manager em BRL usa cotação − deságio. O topo mostra a cotação com deságio.
- **Sincronização** (Integrações): coluna **Janela** editável (Últimos dias D-X → hoje, ou Incremental) e **"Exclua dados com mais de X dias"** para grupos/conjuntos e anúncios antigos. Tooltip com a última mensagem do job.
- Tipos: `Role` ganha `gerente`; `User` troca `squadId` por `squadIds`, `companyIds`, `domains: DomainLink[]`; novos `MyCompany`, `Company`, `CompanyOverviewResponse`, `FxDiscountResponse`; `Domain.gamAccountId/managers`, `Squad.companyId`, `SyncSetting.windowMode/windowDays/windowEditable/hasRetention/retentionDays/lastMessage`, `FxLatest.brlDiscount/brlRevenueRate`.
- Servidor: migration `004_empresas_gerente_vinculos.sql`, escopo novo em `auth/scope.ts` (filtro obrigatório em `aggregate`), `routes/companies.ts`, `routes/admin/companies.ts`, `services/sync/cleanup.ts`; workers não param numa conta com erro e pulam contas inativas; Ad Manager com várias redes; login conta só tentativas erradas.

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
