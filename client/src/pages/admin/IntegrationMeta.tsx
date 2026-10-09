// import { Card, CardContent, Grid } from '@mui/material';
// import { useIntegrations } from '@/hooks/queries';
// import { ErrorBox, PageHead, PageSkeleton, Stat } from '@/components/ui/States';
// import { relTime } from '@/lib/format';
// import { AccountsCard, ConnectButton, SyncPanel, useConnect } from './shared';

// export default function IntegrationMetaPage() {
//   const { data, error, refetch } = useIntegrations();
//   const { connect, snack } = useConnect();
//   if (error) return <ErrorBox error={error} retry={() => refetch()} />;
//   if (!data) return <PageSkeleton />;
//   const m = data.meta;
//   return (
//     <>
//       <PageHead title="Integração · Meta Ads" sub="Conecte o Business Manager via OAuth." right={<ConnectButton onClick={() => connect('meta')}>Conectar Meta</ConnectButton>} />
//       <Card><CardContent><Grid container spacing={1.5}>{[['Business', m.business], ['Usuário', m.user], ['Contas de anúncio', String(m.accounts.length)], ['Última sincronização', relTime(m.lastSyncAt)]].map(([l, v]) => <Grid key={l} size={{ xs: 6, md: 3 }}><Stat label={l}>{v}</Stat></Grid>)}</Grid></CardContent></Card>
//       <AccountsCard provider="meta" title="Contas de anúncio" />
//       <SyncPanel provider="meta" />{snack}
//     </>
//   );
// }

import { useState } from 'react';
import { Alert, Button, Card, CardContent, CardHeader, Grid, MenuItem, Select, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import { useIntegrations, useUnassignedCampaigns, useAdminDomains, useAssignCampaignDomain } from '@/hooks/queries';
import { integrationsApi } from '@/lib/api/endpoints';
import { ErrorBox, PageHead, PageSkeleton, Stat } from '@/components/ui/States';
import { relTime } from '@/lib/format';
import { AccountsCard, ConnectButton, SyncPanel, useConnect } from './shared';

function UnassignedCampaignsCard() {
  const { data, isLoading } = useUnassignedCampaigns();
  const { data: doms } = useAdminDomains();
  const assign = useAssignCampaignDomain();
  
  const [selectedDomains, setSelectedDomains] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const campaigns = data?.campaigns ?? [];

  if (isLoading || campaigns.length === 0) return null;

  const handleDomainChange = (campaignId: string, domainId: string) => {
    setSelectedDomains((prev) => ({ ...prev, [campaignId]: domainId }));
  };

  const handleSaveAndSync = async (campaignId: string) => {
    const domainId = selectedDomains[campaignId];
    if (!domainId) return;

    setSyncing(true);
    setFeedback(null);
    try {
      await assign.mutateAsync({ id: campaignId, domainId });
      await integrationsApi.syncNow('meta');
      setFeedback('Domínio vinculado e sincronização da Meta enfileirada com sucesso.');
    } catch {
      setFeedback('Erro ao salvar vínculo ou enfileirar sincronização.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card sx={{ mt: 1.75 }}>
      <CardHeader
        title="Campanhas sem Domínio (Chatbots / Mensagens)"
        subheader={`${campaigns.length} campanha(s) descartada(s) do ROI por falta de destino identificado`}
      />
      {feedback && <Alert severity="info" sx={{ mx: 2, mb: 1 }}>{feedback}</Alert>}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Campanha</TableCell>
              <TableCell>ID Externo (Meta)</TableCell>
              <TableCell>Conta de Anúncio</TableCell>
              <TableCell sx={{ minWidth: 220 }}>Vincular ao Domínio</TableCell>
              <TableCell align="right">Ação</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {campaigns.map((c) => {
              const currentDomain = selectedDomains[c.id] || '';
              return (
                <TableRow key={c.id}>
                  <TableCell><b>{c.name}</b></TableCell>
                  <TableCell sx={{ fontFamily: 'IBM Plex Mono', fontSize: 13 }}>{c.externalId}</TableCell>
                  <TableCell>{c.accountName}</TableCell>
                  <TableCell>
                    <Select
                      size="small"
                      fullWidth
                      displayEmpty
                      value={currentDomain}
                      onChange={(e) => handleDomainChange(c.id, e.target.value)}
                    >
                      <MenuItem value="" disabled><em>Selecione o site</em></MenuItem>
                      {doms?.domains.map((d) => (
                        <MenuItem key={d.hostname} value={d.hostname}>
                          {d.hostname}
                        </MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant="contained"
                      disabled={!currentDomain || assign.isPending || syncing}
                      onClick={() => handleSaveAndSync(c.id)}
                    >
                      Salvar e Sincronizar
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  );
}

export default function IntegrationMetaPage() {
  const { data, error, refetch } = useIntegrations();
  const { connect, snack } = useConnect();
  
  if (error) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  
  const m = data.meta;
  
  return (
    <>
      <PageHead title="Integração · Meta Ads" sub="Conecte o Business Manager via OAuth." right={<ConnectButton onClick={() => connect('meta')}>Conectar Meta</ConnectButton>} />
      <Card><CardContent><Grid container spacing={1.5}>{[['Business', m.business], ['Usuário', m.user], ['Contas de anúncio', String(m.accounts.length)], ['Última sincronização', relTime(m.lastSyncAt)]].map(([l, v]) => <Grid key={l} size={{ xs: 6, md: 3 }}><Stat label={l}>{v}</Stat></Grid>)}</Grid></CardContent></Card>
      
      <AccountsCard provider="meta" title="Contas de anúncio" />
      
      {/* NOVO: Componente responsável por lidar com as campanhas de mensagens que falharam no resolveDomain */}
      <UnassignedCampaignsCard />
      
      <SyncPanel provider="meta" />{snack}
    </>
  );
}