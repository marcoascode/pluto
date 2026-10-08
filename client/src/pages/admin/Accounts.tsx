import { Box, Button, Card, Grid, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useIntegrations } from '@/hooks/queries';
import { ErrorBox, PageHead, PageSkeleton, StatusChip } from '@/components/ui/States';
import { relTime } from '@/lib/format';
import type { AccountStatus } from '@/types/api';

export default function AccountsPage() {
  const { data, error, refetch } = useIntegrations();
  if (error) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  const issues = (l: AccountStatus[]) => l.filter((a) => a.status !== 'ok' && a.status !== 'not_imported');
  const card = (t: string, to: string, st: string, sub: string, items: AccountStatus[]) => (
    <Grid size={{ xs: 12, md: 4 }}>
      <Card sx={{ p: 2, height: '100%' }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }} ><Typography variant="h2">{t}</Typography><StatusChip status={st} /></Stack>
        <Typography variant="caption" component="div" sx={{ mt: 0.75, mb: 1 }}>{sub}</Typography>
        {(items.length ? items : [null]).map((a, i) => (
          <Stack key={a?.id ?? i} direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center', py: 1, borderTop: 1, borderColor: 'divider' }}>
            {a ? <><Box><Typography sx={{ fontSize: 13 }} >{a.name}</Typography><Typography variant="caption">{a.message}</Typography></Box><StatusChip status={a.status} /></> : <Typography variant="caption">Nenhum problema.</Typography>}
          </Stack>
        ))}
        <Button size="small" variant="outlined" component={RouterLink} to={to} sx={{ mt: 1 }}>Gerenciar</Button>
      </Card>
    </Grid>
  );
  const gi = issues(data.google.accounts), mi = issues(data.meta.accounts), ni = issues(data.gam.accounts ?? []);
  /** Pior status da lista (erro > token > aviso/atraso > ok). */
  const worst = (l: AccountStatus[], base = 'ok') => { const s = new Set(l.map((a) => a.status)); return s.has('disconnected') ? 'disconnected' : s.has('error') ? 'error' : s.has('permission') ? 'permission' : s.has('token') ? 'token' : s.has('late') ? 'late' : s.has('warn') ? 'warn' : base; };
  return (
    <>
      <PageHead title="Contas" sub="Status de todas as conexões. Problemas aparecem aqui primeiro." />
      <Grid container spacing={1.75}>
        {card('Google Ads', '/admin/integracoes/google-ads', worst(gi), `${data.google.mccName} · último sync ${relTime(data.google.lastSyncAt)}`, gi)}
        {card('Meta Ads', '/admin/integracoes/meta-ads', worst(mi), `${data.meta.business} · último sync ${relTime(data.meta.lastSyncAt)}`, mi)}
        {card('Google Ad Manager', '/admin/integracoes/ad-manager', data.gam.status === 'ok' ? worst(ni) : data.gam.status, `${data.gam.networkName} · ${data.gam.networkCode} · último sync ${relTime(data.gam.lastSyncAt)}`, ni)}
      </Grid>
    </>
  );
}
