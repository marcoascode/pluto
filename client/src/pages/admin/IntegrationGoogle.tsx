import { Card, CardContent, Grid, Stack, Typography } from '@mui/material';
import { useIntegrations } from '@/hooks/queries';
import { ErrorBox, PageHead, PageSkeleton, Stat, Tag } from '@/components/ui/States';
import { relTime } from '@/lib/format';
import { AccountsCard, ConnectButton, SyncPanel, useConnect } from './shared';

export default function IntegrationGooglePage() {
  const { data, error, refetch } = useIntegrations();
  const { connect, snack } = useConnect();
  if (error) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  const g = data.google;
  return (
    <>
      <PageHead title="Integração · Google Ads" sub="Conecte a MCC uma vez via OAuth e escolha quais contas importar." right={<ConnectButton onClick={() => connect('google-ads')}>Conectar conta Google</ConnectButton>} />
      <Card><CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>{g.connected ? <Tag tone="pos">Google Ads conectado</Tag> : <Tag tone="neg">Desconectado</Tag>}<Typography variant="caption">via {g.googleAccount}</Typography></Stack>
        <Grid container spacing={1.5}>{[['MCC', g.mccName], ['Customer ID', g.mccCustomerId], ['Contas encontradas', String(g.accountsFound)], ['Última sincronização', relTime(g.lastSyncAt)]].map(([l, v]) => <Grid key={l} size={{ xs: 6, md: 3 }}><Stat label={l}>{v}</Stat></Grid>)}</Grid>
      </CardContent></Card>
      <AccountsCard provider="google-ads" title="Contas da MCC" />
      <SyncPanel provider="google-ads" />{snack}
    </>
  );
}
