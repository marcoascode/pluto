import { Alert, Box, Card, CardContent, CardHeader, Chip, Grid, List, ListItem, ListItemText, Stack, Step, StepLabel, Stepper, Typography } from '@mui/material';
import { useIntegrations } from '@/hooks/queries';
import { ErrorBox, PageHead, PageSkeleton, Stat, StatusChip, Tag } from '@/components/ui/States';
import { relTime } from '@/lib/format';
import { AccountsCard, ConnectButton, SyncPanel, useConnect } from './shared';

const GROUPS: [string, [string, 'GAM' | 'Pluto' | 'GAM + atribuição' | 'a definir'][]][] = [
  ['Receita', [['Revenue / Estimated revenue', 'GAM'], ['Receita líquida = bruta × (1 − revShare do domínio)', 'Pluto'], ['Por data, domínio e país', 'GAM'], ['Por URL e por campanha', 'GAM + atribuição']]],
  ['Delivery', [['Ad Requests', 'GAM'], ['Matched Requests', 'GAM'], ['Responses served (Total code served)', 'GAM'], ['Impressions', 'GAM'], ['Unfilled Impressions', 'GAM'], ['Fill Rate', 'Pluto'], ['Drop-off = (Responses served − Impressions) / Responses served', 'Pluto']]],
  ['Performance', [['Clicks', 'GAM'], ['CTR', 'GAM'], ['eCPM / CPM', 'GAM'], ['Active View measurable / viewable', 'GAM'], ['Active View viewable %', 'GAM']]],
  ['Dimensões', [['Date · Domain · Country · Device', 'GAM'], ['Ad Unit · Placement', 'GAM'], ['Custom targeting (key-values)', 'GAM'], ['URL / landing page', 'GAM + atribuição']]],
  ['Derivadas', [['Sessions', 'Pluto'], ['RPS = Revenue / Sessions × 1000', 'Pluto'], ['Profit, ROI, Margem', 'Pluto'], ['PMR', 'a definir']]],
];
const STEPS = ['Conectar', 'Login Google', 'OAuth', 'Autorizar a conta com acesso ao GAM', 'Rede identificada', 'Sincroniza dados'];

export default function IntegrationGamPage() {
  const { data, error, refetch } = useIntegrations();
  const { connect, snack } = useConnect();
  if (error) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  const g = data.gam;
  return (
    <>
      <PageHead title="Integração · Google Ad Manager" sub="Uma rede principal. A conta Google é autenticada via OAuth." right={<ConnectButton onClick={() => connect('gam')}>Conectar conta Google</ConnectButton>} />
      <Card><CardContent>
        <Stepper activeStep={g.connected ? STEPS.length : 0} alternativeLabel sx={{ mb: 3, display: { xs: 'none', md: 'flex' } }}>{STEPS.map((s) => <Step key={s}><StepLabel>{s}</StepLabel></Step>)}</Stepper>
        <Grid container spacing={1.5}>{([['Conta Google', g.googleAccount], ['Network', g.networkName], ['Network Code', g.networkCode], ['Status', <StatusChip key="s" status={g.status} />], ['Última sincronização', relTime(g.lastSyncAt)]] as const).map(([l, v]) => <Grid key={l} size={{ xs: 6, md: 'grow' }}><Stat label={l}>{v}</Stat></Grid>)}</Grid>
      </CardContent></Card>
      <Card sx={{ mt: 1.75 }}>
        <CardHeader title="O que é sincronizado" subheader="GAM = nativo do Ad Manager · Pluto = calculado pelo sistema" />
        <CardContent><Grid container spacing={1.5}>{GROUPS.map(([t, items]) => (
          <Grid key={t} size={{ xs: 12, sm: 6, lg: 4 }}><Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2.5, bgcolor: 'rgba(26,45,82,.6)', p: 1.5, height: '100%' }}>
            <Typography variant="h3">{t}</Typography>
            <List dense disablePadding>{items.map(([n, k]) => <ListItem key={n} disableGutters secondaryAction={k === 'GAM' ? <Tag tone="accent">GAM</Tag> : k === 'Pluto' ? <Tag tone="pos">Pluto</Tag> : <Chip size="small" label={k} />}><ListItemText primary={n} slotProps={{ primary: { sx: { fontSize: 12.5 } } }} /></ListItem>)}</List>
          </Box></Grid>
        ))}</Grid>
          <Stack sx={{ mt: 1.5 }}><Typography variant="caption">Se uma métrica não existir nativamente no Ad Manager, ela não é simulada: vem do tracking próprio ou fica marcada como indisponível.</Typography></Stack>
        </CardContent>
      </Card>
      <AccountsCard provider="gam" title="Redes do Ad Manager" />
      <Alert severity="info" variant="outlined" sx={{ mt: 1.75 }}>
        Para a receita entrar por campanha, o site precisa mandar no GPT os key-values <b>utm_campaign</b> e <b>utm_content</b> (e, se quiser, utm_source),
        e no Ad Manager esses keys precisam estar como <b>dimensão personalizada</b> (Inventário → Key-values → “Report on values”). Sem isso a receita entra como “não atribuída”.
        Para a tela <b>Placements</b>, o site também manda o key-value <b>placement</b> com o valor do <b>{'{placement}'}</b> da URL do anúncio (mesma configuração de dimensão personalizada).
      </Alert>
      <SyncPanel provider="gam" />{snack}
    </>
  );
}
