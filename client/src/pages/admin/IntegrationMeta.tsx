import { Button, Card, CardContent, Grid } from '@mui/material';
import PowerOutlinedIcon from '@mui/icons-material/PowerOutlined';
import { useIntegrations } from '@/hooks/queries';
import { ErrorBox, PageHead, PageSkeleton, Stat } from '@/components/ui/States';
import { relTime } from '@/lib/format';
import { AccountsCard, SyncPanel, useConnect } from './shared';

export default function IntegrationMetaPage() {
  const { data, error, refetch } = useIntegrations();
  const { connect, snack } = useConnect();
  if (error) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  const m = data.meta;
  return (
    <>
      <PageHead title="Integração · Meta Ads" sub="Conecte o Business Manager via OAuth." right={<Button variant="contained" startIcon={<PowerOutlinedIcon />} onClick={() => connect('meta')}>Conectar Meta</Button>} />
      <Card><CardContent><Grid container spacing={1.5}>{[['Business', m.business], ['Usuário', m.user], ['Contas de anúncio', String(m.accounts.length)], ['Última sincronização', relTime(m.lastSyncAt)]].map(([l, v]) => <Grid key={l} size={{ xs: 6, md: 3 }}><Stat label={l}>{v}</Stat></Grid>)}</Grid></CardContent></Card>
      <AccountsCard provider="meta" title="Contas de anúncio" />
      <SyncPanel provider="meta" />{snack}
    </>
  );
}
