import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Snackbar, Stack, Typography } from '@mui/material';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import { useMemo, useState, type ReactNode } from 'react';
import { copyText } from '@/components/ui/States';
import trackerHtml from '@/assets/pluto-tracker.html?raw';

/** Endereço da coleta: o do próprio painel (app.plutomidia.com.br em produção; o ambiente certo em homologação). */
const ENDPOINT_IN_FILE = 'https://app.plutomidia.com.br/api/collect';

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
      <Box sx={{ flex: '0 0 26px', height: 26, borderRadius: '50%', bgcolor: 'primary.main', color: 'primary.contrastText', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 600 }}>{n}</Box>
      <Box sx={{ minWidth: 0 }}><Typography sx={{ fontWeight: 600, mb: 0.25 }}>{title}</Typography><Typography component="div" variant="body2" color="text.secondary">{children}</Typography></Box>
    </Stack>
  );
}
/** SiteGround Speed Optimizer: tira o código do Pluto do "Combinar JavaScript" (o filtro compara o início do script inline). */
const SG_SNIPPET = `add_filter( 'sgo_javascript_combine_excluded_inline_content', function ( $exclude_list ) {
	$exclude_list[] = 'window.pluto_utm_tracker';
	return $exclude_list;
} );`;

const Mono = ({ children }: { children: ReactNode }) => <Box component="code" sx={{ fontFamily: 'IBM Plex Mono', fontSize: '0.92em', px: 0.5, borderRadius: 0.5, bgcolor: 'action.hover' }}>{children}</Box>;

/**
 * 0.18 · Botão "Código do rastreador" (tela Atribuição): mostra e copia o script do Pluto que vai no <head> dos sites
 * WordPress (client/src/assets/pluto-tracker.html), com onde colar e o que fazer com plugins de cache/otimização.
 */
export function TrackerCodeButton() {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const code = useMemo(() => trackerHtml.replace(ENDPOINT_IN_FILE, `${window.location.origin}/api/collect`).trim(), []);
  const copy = async () => setMsg((await copyText(code)) ? 'Código copiado. Cole no site conforme as instruções.' : 'Não foi possível copiar: selecione o código e use Ctrl+C.');
  return (
    <>
      <Button variant="contained" size="small" startIcon={<CodeRoundedIcon />} onClick={() => setOpen(true)}>Código do rastreador</Button>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth scroll="paper" aria-labelledby="tracker-code-title">
        <DialogTitle id="tracker-code-title" sx={{ pr: 6 }}>
          Código do rastreador Pluto
          <IconButton aria-label="Fechar" onClick={() => setOpen(false)} sx={{ position: 'absolute', right: 10, top: 10 }}><CloseRoundedIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2 }}>
            <b>Para que serve:</b> liga a receita do Ad Manager às campanhas Meta e Google Ads quando o Ad Manager não informa o UTM no relatório.
            O código guarda o <Mono>utm_campaign</Mono> e o <Mono>utm_content</Mono> da visita e conta os anúncios exibidos em cada página, por bloco de anúncios e tipo de dispositivo,
            de <b>todas</b> as visitas (com e sem UTM). Com isso, a receita de cada bloco × país × dispositivo no Ad Manager é dividida pela participação de cada campanha
            nas impressões. Ele não usa cookies nem guarda dados pessoais (o país vem do IP no servidor, que não é gravado).
          </Typography>
          <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
            <b>Versão 1.2.</b> Se o site já tem o código, <b>substitua</b> o antigo (v1.1) por este, no mesmo lugar: logo após <Mono>&lt;head&gt;</Mono> e antes do GTM. Não deixe as duas versões juntas.
          </Alert>

          <Box sx={{ position: 'relative', mb: 2.5 }}>
            <Box component="pre" sx={{ m: 0, p: 2, pr: 6, maxHeight: 280, overflow: 'auto', borderRadius: 1, border: 1, borderColor: 'divider', bgcolor: 'action.hover', fontFamily: 'IBM Plex Mono', fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre' }}>{code}</Box>
            <IconButton aria-label="Copiar código" onClick={copy} size="small" sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'background.paper' }}><ContentCopyRoundedIcon fontSize="small" /></IconButton>
          </Box>

          <Typography variant="h3" sx={{ mb: 1.5 }}>Onde colocar (em cada site WordPress)</Typography>
          <Stack spacing={1.75} sx={{ mb: 2.5 }}>
            <Step n={1} title="Abra o plugin WP Headers and Footers">No painel do WordPress do site: <b>Configurações → WP Headers and Footers</b>, aba <b>Header</b> (campo “Scripts in Header”).</Step>
            <Step n={2} title="Cole o código ANTES da tag do GTM">
              Posicione o código na <b>primeira linha</b> do campo, <b>acima</b> do bloco <Mono>{'<!-- Google Tag Manager -->'}</Mono>. Não apague nada do que já está lá.
              O código precisa carregar antes dos blocos de anúncios. Se for colocado depois do GTM, na aba Body/Footer, no Ad Inserter ou como tag dentro do GTM,
              ele chega tarde e perde as impressões dos primeiros anúncios da página.
            </Step>
            <Step n={3} title="Salve e mantenha o resto como está">
              Clique em <b>Save</b>. Os blocos do Ad Inserter e o script que já envia o <Mono>setTargeting</Mono> de <Mono>utm_campaign</Mono> / <Mono>utm_content</Mono> continuam iguais: não remova nada.
              Cole o código <b>uma vez por site</b>; subdomínios com WordPress próprio (ex.: <Mono>en.</Mono>, <Mono>es.</Mono>) precisam dele também.
            </Step>
          </Stack>

          <Alert severity="warning" variant="outlined" sx={{ mb: 2.5 }}>
            <Typography sx={{ fontWeight: 600, mb: 0.75 }}>Tem plugin de cache ou otimização instalado? (WP Rocket, LiteSpeed Cache, Autoptimize, W3 Total Cache, Perfmatters…)</Typography>
            <Typography component="div" variant="body2">
              Esses plugins costumam <b>atrasar</b> (delay), <b>adiar</b> (defer), <b>juntar</b> (combine) ou <b>minificar</b> os scripts da página.
              Com o código atrasado, ele só roda depois que o visitante toca na tela, e quem sai sem tocar não é contado. Faça assim:
              <Box component="ol" sx={{ pl: 2.5, my: 1, '& li': { mb: 0.75 } }}>
                <li>Procure as listas de exclusão de JavaScript do plugin: “Delay JavaScript execution / Atrasar a execução do JavaScript”, “Load JavaScript deferred / Adiar”, “Combine / Combinar JavaScript” e “Minify inline JS”.</li>
                <li>Em cada uma dessas listas que aceite texto, adicione a palavra-chave <Mono>pluto_utm</Mono> (ela identifica o código do Pluto).
                  Exemplos: no <b>WP Rocket</b>, Otimização de arquivos → Atrasar a execução do JavaScript → <i>Arquivos JavaScript excluídos</i>.
                  No <b>LiteSpeed Cache</b>, Otimização da página → Ajustes → <i>JS Deferred / Delayed Excludes</i>. No <b>Autoptimize</b>, JS → <i>Excluir scripts</i>, ou desligue “Agregar JS inline”.</li>
                <li>Se o plugin atrasa ou adia o <Mono>gpt.js</Mono> / Ad Inserter, mantenha a configuração que já funciona para os anúncios. O código do Pluto só precisa ficar <b>fora</b> do atraso.</li>
                <li>Salve e <b>limpe todo o cache</b>: o do plugin, o da hospedagem e, se houver, o do Cloudflare. Sem isso, as páginas em cache continuam sem o código.</li>
              </Box>
            </Typography>
          </Alert>

          <Alert severity="info" variant="outlined" sx={{ mb: 2.5 }}>
            <Typography sx={{ fontWeight: 600, mb: 0.75 }}>Sites na SiteGround com o plugin Speed Optimizer</Typography>
            <Typography component="div" variant="body2">
              Em <b>Frontend → JavaScript</b>, as listas de exclusão mostram só os <b>arquivos</b> de script registrados por plugins e pelo tema.
              O código do Pluto fica escrito dentro da página (script inline, colado pelo WP Headers and Footers), por isso <Mono>pluto_utm</Mono> nunca aparece nessas listas, e isso é esperado.
              <Box component="ul" sx={{ pl: 2.5, my: 1, '& li': { mb: 0.75 } }}>
                <li><b>Minify JavaScript Files</b> e <b>Defer Render-blocking JavaScript</b>: <b>nada a fazer</b>. Eles atuam sobre arquivos, e o navegador ignora o adiamento (defer) em scripts inline.</li>
                <li><b>Combine JavaScript Files</b>: pode juntar scripts inline num arquivo carregado mais tarde. O código já conta os anúncios que apareceram antes de ele rodar, então funciona mesmo combinado. Perde-se só a visita que sai antes de esse arquivo carregar. Para tirar o código da combinação (opcional e mais preciso), peça ao desenvolvedor para adicionar o trecho abaixo com o plugin <b>Code Snippets</b> (“Executar em todo o site”) ou no <Mono>functions.php</Mono> do tema filho:</li>
              </Box>
              <Box sx={{ position: 'relative', mb: 1 }}>
                <Box component="pre" sx={{ m: 0, p: 1.5, pr: 6, overflow: 'auto', borderRadius: 1, border: 1, borderColor: 'divider', bgcolor: 'action.hover', fontFamily: 'IBM Plex Mono', fontSize: 12, whiteSpace: 'pre' }}>{SG_SNIPPET}</Box>
                <IconButton aria-label="Copiar trecho PHP" size="small" onClick={async () => setMsg((await copyText(SG_SNIPPET)) ? 'Trecho PHP copiado.' : 'Não foi possível copiar.')} sx={{ position: 'absolute', top: 6, right: 6, bgcolor: 'background.paper' }}><ContentCopyRoundedIcon fontSize="small" /></IconButton>
              </Box>
              Depois de colar o código do Pluto (ou mudar qualquer opção), limpe o cache: botão <b>Purge SG Cache</b> na barra do topo do WordPress, ou Speed Optimizer → Caching → limpar cache.
            </Typography>
          </Alert>

          <Typography variant="h3" sx={{ mb: 1 }}>Como conferir</Typography>
          <Typography component="div" variant="body2" color="text.secondary">
            Abra o site com UTMs na URL (por exemplo, pela visualização do anúncio na Meta). Clique com o botão direito → <b>Exibir código-fonte</b> e procure por <Mono>pluto_utm</Mono>.
            O código deve aparecer antes do <Mono>Google Tag Manager</Mono>. No console do navegador, <Mono>sessionStorage.getItem('pluto_utm')</Mono> deve mostrar as UTMs da visita.
            No código-fonte, a 1ª linha do comentário deve dizer <Mono>v1.2</Mono>; na aba Rede (Network), os envios para <Mono>/api/collect</Mono> levam <Mono>"v":2</Mono> e os blocos em <Mono>"u"</Mono>.
            A receita aparece por campanha no próximo sync do Ad Manager, em até 1 hora, e só a partir da instalação, sem retroativo.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Fechar</Button>
          <Button variant="contained" startIcon={<ContentCopyRoundedIcon />} onClick={copy}>Copiar código</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={!!msg} autoHideDuration={4500} onClose={() => setMsg('')} message={msg} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </>
  );
}
