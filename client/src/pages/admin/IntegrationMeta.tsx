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

import { useState, useMemo } from 'react';
import {
  Alert, Button, Card, CardContent, CardHeader, Grid, MenuItem, Select, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField,
  TablePagination, Typography, Box
} from '@mui/material';
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

  // Estados de Filtro e Paginação
  const [searchQuery, setSearchQuery] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const rowsPerPage = 20;

  const campaigns = data?.campaigns ?? [];

  // Lógica de Filtragem
  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((c) => {
      const matchSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          c.externalId.includes(searchQuery);
      const matchAccount = accountFilter ? c.accountId === accountFilter : true;
      const matchStatus = statusFilter 
        ? (statusFilter === 'ACTIVE' ? c.status === 'ACTIVE' : c.status !== 'ACTIVE')
        : true;

      return matchSearch && matchAccount && matchStatus;
    });
  }, [campaigns, searchQuery, accountFilter, statusFilter]);

  // Contas únicas para o filtro
  const uniqueAccounts = useMemo(() => {
    const accMap = new Map();
    campaigns.forEach(c => {
      if (!accMap.has(c.accountId)) {
        accMap.set(c.accountId, c.accountName);
      }
    });
    return Array.from(accMap.entries()).map(([id, name]) => ({ id, name }));
  }, [campaigns]);

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

  // Paginação (corrigido _event para satisfazer o linter)
  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const paginatedCampaigns = filteredCampaigns.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Card sx={{ mt: 1.75 }}>
      <CardHeader
        title="Campanhas sem Domínio (Chatbots / Mensagens)"
        subheader={`${campaigns.length} campanha(s) descartada(s) do ROI por falta de destino identificado`}
      />
      
      {/* Controles de Filtro */}
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField
            size="small"
            label="Buscar por nome ou ID"
            variant="outlined"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
            sx={{ flexGrow: 1 }}
          />
          <Select
            size="small"
            displayEmpty
            value={accountFilter}
            onChange={(e) => { setAccountFilter(e.target.value); setPage(0); }}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value=""><em>Todas as Contas</em></MenuItem>
            {uniqueAccounts.map((acc) => (
              <MenuItem key={acc.id} value={acc.id}>{acc.name}</MenuItem>
            ))}
          </Select>
          <Select
            size="small"
            displayEmpty
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value=""><em>Todos os Status</em></MenuItem>
            <MenuItem value="ACTIVE">Ativa</MenuItem>
            <MenuItem value="INACTIVE">Inativa</MenuItem>
          </Select>
        </Stack>
      </Box>

      {feedback && <Alert severity="info" sx={{ mx: 2, my: 1 }}>{feedback}</Alert>}
      
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Campanha</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>ID Externo (Meta)</TableCell>
              <TableCell>Conta de Anúncio</TableCell>
              <TableCell sx={{ minWidth: 220 }}>Vincular ao Domínio</TableCell>
              <TableCell align="right">Ação</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedCampaigns.length > 0 ? paginatedCampaigns.map((c) => {
              const currentDomain = selectedDomains[c.id] || '';
              return (
                <TableRow key={c.id}>
                  <TableCell><b>{c.name}</b></TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ 
                      color: c.status === 'ACTIVE' ? 'success.main' : 'text.secondary',
                      fontWeight: c.status === 'ACTIVE' ? 'bold' : 'normal'
                    }}>
                      {c.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}
                    </Typography>
                  </TableCell>
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
            }) : (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                  Nenhuma campanha encontrada com os filtros atuais.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      
      <TablePagination
        component="div"
        count={filteredCampaigns.length}
        page={page}
        onPageChange={handleChangePage}
        rowsPerPage={rowsPerPage}
        rowsPerPageOptions={[20]}
        labelDisplayedRows={({ from, to, count }) => `${from}-${to} de ${count !== -1 ? count : `mais de ${to}`}`}
      />
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
      <Card>
        <CardContent>
          <Grid container spacing={1.5}>
            {[['Business', m.business], ['Usuário', m.user], ['Contas de anúncio', String(m.accounts.length)], ['Última sincronização', relTime(m.lastSyncAt)]].map(([l, v]) => (
              <Grid key={l} size={{ xs: 6, md: 3 }}><Stat label={l}>{v}</Stat></Grid>
            ))}
          </Grid>
        </CardContent>
      </Card>
      
      <AccountsCard provider="meta" title="Contas de anúncio" />
      
      <UnassignedCampaignsCard />
      
      <SyncPanel provider="meta" />
      {snack}
    </>
  );
}