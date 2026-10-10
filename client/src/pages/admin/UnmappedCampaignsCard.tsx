// import { Alert, Box, Snackbar, Card, CardHeader, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
// import { useState } from 'react';
// import { useUnmappedCampaigns } from '@/hooks/queries';
// import { CampaignDomainSelect } from '@/components/campaigns/CampaignDomainSelect';
// import { ErrorBox, PageSkeleton, Tag } from '@/components/ui/States';
// import { ddmm, int, money } from '@/lib/format';
// import type { Platform } from '@/types/api';

// /**
//  * Campanhas sem domínio (custo gravado em "Sem domínio" nos últimos 30 dias, ou ativas sem domínio), com o seletor
//  * de domínio ao lado. É a lista do aviso "linhas sem domínio" das contas. Ao salvar, o passado é movido e a janela
//  * da plataforma é ressincronizada.
//  */
// export function UnmappedCampaignsCard({ platform = 'meta' }: { platform?: Platform }) {
//   const { data, error, refetch } = useUnmappedCampaigns(platform);
//   const [saved, setSaved] = useState('');
//   const snack = <Snackbar open={!!saved} autoHideDuration={4500} onClose={() => setSaved('')} message={saved} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />;
//   if (error) return <Box sx={{ mt: 1.75 }}><ErrorBox error={error} retry={() => refetch()} /></Box>;
//   if (!data) return <Box sx={{ mt: 1.75 }}><PageSkeleton /></Box>;
//   const list = data.campaigns;
//   if (!list.length) return <><Alert severity="success" variant="outlined" sx={{ mt: 1.75 }}>Nenhuma campanha sem domínio nos últimos {data.days} dias. Todo o custo está ligado a um site.</Alert>{snack}</>;
//   return (
//     <Card sx={{ mt: 1.75, borderColor: 'warning.main' }}>
//       <CardHeader title={<Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><span>Campanhas sem domínio</span><Tag tone="warn">{list.length}</Tag></Stack>}
//         subheader={`${money(data.totals.spend, 'USD')} de custo (com IVA) nos últimos ${data.days} dias está em "Sem domínio": entra no total, mas em nenhum site. Defina o domínio de cada campanha; o histórico é movido e a janela é ressincronizada.`} />
//       <TableContainer><Table>
//         <TableHead><TableRow>{['Campanha', 'Conta', 'Custo', 'Cliques', 'Período', 'Domínio'].map((h) => <TableCell key={h} align={['Custo', 'Cliques'].includes(h) ? 'right' : 'left'}>{h}</TableCell>)}</TableRow></TableHead>
//         <TableBody>{list.map((c) => (
//           <TableRow key={c.id}>
//             <TableCell sx={{ whiteSpace: 'normal', minWidth: 220 }}><b>{c.name}</b><Typography variant="caption" component="div" sx={{ fontFamily: 'IBM Plex Mono' }}>{c.id}{c.status !== 'ENABLED' ? ' · Pausada' : ''}</Typography></TableCell>
//             <TableCell>{c.accountName}</TableCell>
//             <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{c.spend ? money(c.spend, 'USD') : '—'}</TableCell>
//             <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{c.rows ? int(c.clicks) : '—'}</TableCell>
//             <TableCell>{c.firstDate && c.lastDate ? `${ddmm(c.firstDate)} – ${ddmm(c.lastDate)}` : 'sem custo ainda'}</TableCell>
//             <TableCell><CampaignDomainSelect id={c.id} platform={c.platform} name={c.name} onSaved={setSaved} /></TableCell>
//           </TableRow>
//         ))}</TableBody>
//       </Table></TableContainer>
//       {snack}
//     </Card>
//   );
// }

import { Alert, Box, Snackbar, Card, CardHeader, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, TextField, Select, MenuItem, TablePagination } from '@mui/material';
import { useState } from 'react';
import { useUnmappedCampaigns } from '@/hooks/queries';
import { CampaignDomainSelect } from '@/components/campaigns/CampaignDomainSelect';
import { ErrorBox, PageSkeleton, Tag } from '@/components/ui/States';
import { ddmm, int, money } from '@/lib/format';
import type { Platform } from '@/types/api';

/**
 * Campanhas sem domínio (custo gravado em "Sem domínio" nos últimos 30 dias, ou ativas sem domínio), com o seletor
 * de domínio ao lado. É a lista do aviso "linhas sem domínio" das contas. Ao salvar, o passado é movido e a janela
 * da plataforma é ressincronizada.
 */
export function UnmappedCampaignsCard({ platform = 'meta' }: { platform?: Platform }) {
  const { data, error, refetch } = useUnmappedCampaigns(platform);
  const [saved, setSaved] = useState('');
  
  // Estados de Filtro e Paginação[cite: 1]
  const [searchQuery, setSearchQuery] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [page, setPage] = useState(0);
  const rowsPerPage = 20;

  const snack = <Snackbar open={!!saved} autoHideDuration={4500} onClose={() => setSaved('')} message={saved} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />;
  
  if (error) return <Box sx={{ mt: 1.75 }}><ErrorBox error={error} retry={() => refetch()} /></Box>;
  if (!data) return <Box sx={{ mt: 1.75 }}><PageSkeleton /></Box>;
  
  const list = data.campaigns;
  
  if (!list.length) return <><Alert severity="success" variant="outlined" sx={{ mt: 1.75 }}>Nenhuma campanha sem domínio nos últimos {data.days} dias. Todo o custo está ligado a um site.</Alert>{snack}</>;

  // Extrai contas únicas para montar o filtro suspenso
  const uniqueAccounts = Array.from(new Set(list.map((c) => c.accountName))).sort();

  // Aplica os filtros de busca (Nome/ID) e conta de anúncio
  const filteredList = list.filter((c) => {
    const matchSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.id.includes(searchQuery);
    const matchAccount = accountFilter ? c.accountName === accountFilter : true;
    return matchSearch && matchAccount;
  });

  // Aplica o limite de paginação (20 linhas) sobre a lista já filtrada
  const paginatedList = filteredList.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Card sx={{ mt: 1.75, borderColor: 'warning.main' }}>
      <CardHeader 
        title={<Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><span>Campanhas sem domínio</span><Tag tone="warn">{filteredList.length}</Tag></Stack>}
        subheader={`${money(data.totals.spend, 'USD')} de custo (com IVA) nos últimos ${data.days} dias está em "Sem domínio": entra no total, mas em nenhum site. Defina o domínio de cada campanha; o histórico é movido e a janela é ressincronizada.`} 
      />
      
      {/* Controles de Filtro */}
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField
            size="small"
            label="Buscar por nome ou ID da campanha"
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
            sx={{ minWidth: 220 }}
          >
            <MenuItem value=""><em>Todas as Contas</em></MenuItem>
            {uniqueAccounts.map((accName) => (
              <MenuItem key={accName} value={accName}>{accName}</MenuItem>
            ))}
          </Select>
        </Stack>
      </Box>

      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              {['Campanha', 'Conta', 'Custo', 'Cliques', 'Período', 'Domínio'].map((h) => (
                <TableCell key={h} align={['Custo', 'Cliques'].includes(h) ? 'right' : 'left'}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedList.length > 0 ? (
              paginatedList.map((c) => (
                <TableRow key={c.id}>
                  <TableCell sx={{ whiteSpace: 'normal', minWidth: 220 }}>
                    <b>{c.name}</b>
                    <Typography variant="caption" component="div" sx={{ fontFamily: 'IBM Plex Mono' }}>
                      {c.id}{c.status !== 'ENABLED' ? ' · Pausada' : ''}
                    </Typography>
                  </TableCell>
                  <TableCell>{c.accountName}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{c.spend ? money(c.spend, 'USD') : '—'}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{c.rows ? int(c.clicks) : '—'}</TableCell>
                  <TableCell>{c.firstDate && c.lastDate ? `${ddmm(c.firstDate)} – ${ddmm(c.lastDate)}` : 'sem custo ainda'}</TableCell>
                  <TableCell><CampaignDomainSelect id={c.id} platform={c.platform} name={c.name} onSaved={setSaved} /></TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                  Nenhuma campanha encontrada com os filtros atuais.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      
      {/* Controles de Paginação limitados a 20 itens */}
      <TablePagination
        component="div"
        count={filteredList.length}
        page={page}
        onPageChange={(_event, newPage) => setPage(newPage)}
        rowsPerPage={rowsPerPage}
        rowsPerPageOptions={[20]}
        labelDisplayedRows={({ from, to, count }) => `${from}-${to} de ${count !== -1 ? count : `mais de ${to}`}`}
      />
      {snack}
    </Card>
  );
}