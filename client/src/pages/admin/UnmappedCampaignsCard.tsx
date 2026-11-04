import { Alert, Box, Snackbar, Card, CardHeader, InputAdornment, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography } from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useUnmappedCampaigns } from '@/hooks/queries';
import { CampaignDomainSelect } from '@/components/campaigns/CampaignDomainSelect';
import { ErrorBox, PageSkeleton, Tag } from '@/components/ui/States';
import { ddmm, int, money } from '@/lib/format';
import type { Platform } from '@/types/api';

/** Linhas por página: cada linha tem um seletor de domínio, então a tabela nunca renderiza mais que isso de uma vez. */
const PAGE_SIZE = 20;
/** minúsculas e sem acento, para a busca achar "promoção" digitando "promocao" */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Campanhas sem domínio (custo gravado em "Sem domínio" nos últimos 30 dias, ou ativas sem domínio), com o seletor
 * de domínio ao lado. É a lista do aviso "linhas sem domínio" das contas. Ao salvar, o passado é movido e a janela
 * da plataforma é ressincronizada.
 * Com centenas de campanhas: 20 por página, filtro por conta de anúncio e busca por nome ou ID da campanha
 * (filtro e paginação no navegador; a lista vem inteira numa chamada só).
 */
export function UnmappedCampaignsCard({ platform = 'meta' }: { platform?: Platform }) {
  const { data, error, refetch } = useUnmappedCampaigns(platform);
  const [saved, setSaved] = useState('');
  const [account, setAccount] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const term = useDeferredValue(search);   // digitar não trava a tela enquanto filtra
  const list = data?.campaigns ?? [];
  const accounts = useMemo(() => {
    const m = new Map<string, { id: string; name: string; n: number }>();
    for (const c of list) { const x = m.get(c.accountId) ?? { id: c.accountId, name: c.accountName, n: 0 }; x.n++; m.set(c.accountId, x); }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [list]);
  const filtered = useMemo(() => {
    const t = norm(term);
    return list.filter((c) => (!account || c.accountId === account) && (!t || norm(c.name).includes(t) || c.id.toLowerCase().includes(t)));
  }, [list, account, term]);
  // filtro mudou (ou a lista encolheu depois de salvar um domínio): volta para uma página que existe
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => { setPage(0); }, [account, term]);
  useEffect(() => { if (page > pages - 1) setPage(pages - 1); }, [page, pages]);
  const rows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const filteredSpend = useMemo(() => filtered.reduce((a, c) => a + c.spend, 0), [filtered]);

  const snack = <Snackbar open={!!saved} autoHideDuration={4500} onClose={() => setSaved('')} message={saved} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />;
  if (error) return <Box sx={{ mt: 1.75 }}><ErrorBox error={error} retry={() => refetch()} /></Box>;
  if (!data) return <Box sx={{ mt: 1.75 }}><PageSkeleton /></Box>;
  if (!list.length) return <><Alert severity="success" variant="outlined" sx={{ mt: 1.75 }}>Nenhuma campanha sem domínio nos últimos {data.days} dias. Todo o custo está ligado a um site.</Alert>{snack}</>;
  const filtering = !!account || !!term.trim();
  return (
    <Card sx={{ mt: 1.75, borderColor: 'warning.main' }}>
      <CardHeader title={<Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><span>Campanhas sem domínio</span><Tag tone="warn">{list.length}</Tag></Stack>}
        subheader={`${money(data.totals.spend, 'USD')} de custo (com IVA) nos últimos ${data.days} dias está em "Sem domínio": entra no total, mas em nenhum site. Defina o domínio de cada campanha; o histórico é movido e a janela é ressincronizada.`} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ px: 2, pb: 1.5, alignItems: { sm: 'center' } }}>
        <TextField size="small" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou ID da campanha" sx={{ flex: 1, maxWidth: { sm: 380 } }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }, htmlInput: { 'aria-label': 'Buscar campanha por nome ou ID' } }} />
        <TextField select size="small" label="Conta de anúncio" value={account} onChange={(e) => setAccount(e.target.value)} sx={{ minWidth: 220 }}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
          <MenuItem value="">Todas as contas ({list.length})</MenuItem>
          {accounts.map((a) => <MenuItem key={a.id} value={a.id}>{a.name} ({a.n})</MenuItem>)}
        </TextField>
        {filtering && <Typography variant="caption" sx={{ ml: { sm: 'auto' } }}>{filtered.length} de {list.length} campanhas · {money(filteredSpend, 'USD')}</Typography>}
      </Stack>
      <TableContainer><Table>
        <TableHead><TableRow>{['Campanha', 'Conta', 'Custo', 'Cliques', 'Período', 'Domínio'].map((h) => <TableCell key={h} align={['Custo', 'Cliques'].includes(h) ? 'right' : 'left'}>{h}</TableCell>)}</TableRow></TableHead>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.id}>
              <TableCell sx={{ whiteSpace: 'normal', minWidth: 220 }}><b>{c.name}</b><Typography variant="caption" component="div" sx={{ fontFamily: 'IBM Plex Mono' }}>{c.id}{c.status !== 'ENABLED' ? ' · Pausada' : ''}</Typography></TableCell>
              <TableCell>{c.accountName}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{c.spend ? money(c.spend, 'USD') : '—'}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{c.rows ? int(c.clicks) : '—'}</TableCell>
              <TableCell>{c.firstDate && c.lastDate ? `${ddmm(c.firstDate)} – ${ddmm(c.lastDate)}` : 'sem custo ainda'}</TableCell>
              <TableCell><CampaignDomainSelect id={c.id} platform={c.platform} name={c.name} onSaved={setSaved} /></TableCell>
            </TableRow>
          ))}
          {!rows.length && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>Nenhuma campanha com esse filtro.</TableCell></TableRow>}
        </TableBody>
      </Table></TableContainer>
      {filtered.length > PAGE_SIZE && (
        <TablePagination component="div" count={filtered.length} page={Math.min(page, pages - 1)} onPageChange={(_, p) => setPage(p)}
          rowsPerPage={PAGE_SIZE} rowsPerPageOptions={[PAGE_SIZE]} labelRowsPerPage="Por página"
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
          getItemAriaLabel={(t) => (t === 'next' ? 'Próxima página' : t === 'previous' ? 'Página anterior' : t === 'first' ? 'Primeira página' : 'Última página')} />
      )}
      {snack}
    </Card>
  );
}
