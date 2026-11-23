import { Alert, Box, Card, CardHeader, InputAdornment, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography } from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useMetaTagAudit } from '@/hooks/queries';
import { ErrorBox, PageSkeleton, Tag } from '@/components/ui/States';
import { int, money } from '@/lib/format';
import type { MetaTagAuditAd, MetaTagStatus } from '@/types/api';

const PAGE_SIZE = 20;
const DAYS = 7;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const LABEL: Record<Exclude<MetaTagStatus, 'ok'>, string> = { missing: 'Sem sufixo', different: 'Fora do padrão', unread: 'Não lido' };
type Filter = 'problems' | Exclude<MetaTagStatus, 'ok'>;

function StatusTag({ ad }: { ad: MetaTagAuditAd }) {
  if (ad.status === 'missing') return <Tag tone="neg">{LABEL.missing}</Tag>;
  if (ad.status === 'unread') return <Tag tone="na">{LABEL.unread}</Tag>;
  return <Tag tone={ad.attributable ? 'warn' : 'neg'}>{ad.attributable ? 'Formato antigo' : LABEL.different}</Tag>;
}

/**
 * 0.18 · Anúncios Meta ativos (ou com custo nos últimos 7 dias) cujos "Parâmetros de URL" não seguem o template Meta.
 * Sem o sufixo, o site não recebe utm_campaign/utm_content e a receita do Ad Manager vira "sem campanha" para sempre.
 * O url_tags vem do sync de estrutura da Meta; "Não lido" some depois do próximo sync.
 */
export function MetaTagAuditCard() {
  const { data, error, refetch } = useMetaTagAudit(DAYS);
  const [status, setStatus] = useState<Filter>('problems');
  const [account, setAccount] = useState('');
  const [domain, setDomain] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const term = useDeferredValue(search);
  const list = data?.ads ?? [];
  const accounts = useMemo(() => [...new Map(list.map((a) => [a.accountId, a.managers ? `${a.accountName} · ${a.managers}` : a.accountName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [list]);
  const domains = useMemo(() => [...new Set(list.map((a) => a.domain ?? ''))].sort(), [list]);
  const filtered = useMemo(() => {
    const t = norm(term);
    return list.filter((a) => (status === 'problems' ? a.status === 'missing' || a.status === 'different' : a.status === status)
      && (!account || a.accountId === account) && (!domain || (a.domain ?? '') === domain)
      && (!t || norm(a.name).includes(t) || norm(a.campaignName).includes(t) || a.id.includes(t) || a.campaignId.includes(t)));
  }, [list, status, account, domain, term]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => { setPage(0); }, [status, account, domain, term]);
  useEffect(() => { if (page > pages - 1) setPage(pages - 1); }, [page, pages]);
  const rows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  if (error) return <Box sx={{ mt: 1.75 }}><ErrorBox error={error} retry={() => refetch()} /></Box>;
  if (!data) return <Box sx={{ mt: 1.75 }}><PageSkeleton /></Box>;
  const t = data.totals;
  const problems = t.missing + t.different;
  if (!list.length) return <Alert severity="success" variant="outlined" sx={{ mt: 1.75 }}>Todos os {int(t.ok)} anúncios Meta ativos usam o sufixo padrão.</Alert>;
  return (
    <Card sx={{ mt: 1.75, borderColor: problems ? 'warning.main' : undefined }}>
      <CardHeader
        title={<Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><span>Anúncios Meta fora do padrão de UTM</span>{problems > 0 && <Tag tone="neg">{problems}</Tag>}</Stack>}
        subheader={`${int(t.ok)} ok · ${int(t.missing)} sem sufixo · ${int(t.different)} fora do padrão · ${int(t.unread)} ainda não lidos pelo sync. ${t.spendAtRisk > 0 ? `${money(t.spendAtRisk, 'BRL')} de custo (com IVA) nos últimos ${data.days} dias em anúncios cuja receita não pode ser atribuída. ` : ''}Corrija em "Parâmetros de URL" de cada anúncio no Gerenciador de Anúncios.`} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} useFlexGap sx={{ px: 2, pb: 1.5, alignItems: { sm: 'center' }, flexWrap: 'wrap' }}>
        <TextField size="small" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar anúncio, campanha ou ID" sx={{ flex: 1, minWidth: 220, maxWidth: { sm: 320 } }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }, htmlInput: { 'aria-label': 'Buscar anúncio, campanha ou ID' } }} />
        <TextField select size="small" label="Situação" value={status} onChange={(e) => setStatus(e.target.value as Filter)} sx={{ minWidth: 170 }}>
          <MenuItem value="problems">Com problema ({problems})</MenuItem>
          <MenuItem value="missing">{LABEL.missing} ({t.missing})</MenuItem>
          <MenuItem value="different">{LABEL.different} ({t.different})</MenuItem>
          <MenuItem value="unread">{LABEL.unread} ({t.unread})</MenuItem>
        </TextField>
        <TextField select size="small" label="Conta · gestor" value={account} onChange={(e) => setAccount(e.target.value)} sx={{ minWidth: 220 }} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
          <MenuItem value="">Todas as contas</MenuItem>
          {accounts.map(([id, name]) => <MenuItem key={id} value={id}>{name}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Domínio" value={domain} onChange={(e) => setDomain(e.target.value)} sx={{ minWidth: 180 }} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
          <MenuItem value="">Todos os domínios</MenuItem>
          {domains.map((d) => <MenuItem key={d || '-'} value={d}>{d || 'Sem domínio'}</MenuItem>)}
        </TextField>
      </Stack>
      <TableContainer><Table>
        <TableHead><TableRow>{['Anúncio', 'Conta · gestor', 'Domínio', `Custo ${data.days}d`, 'Parâmetros encontrados', 'Situação'].map((h) => <TableCell key={h} align={h.startsWith('Custo') ? 'right' : 'left'}>{h}</TableCell>)}</TableRow></TableHead>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={`${a.accountId}-${a.id}`}>
              <TableCell sx={{ whiteSpace: 'normal', minWidth: 220 }}><b>{a.name}</b>
                <Typography variant="caption" component="div">{a.campaignName} · {a.adset}</Typography>
                <Typography variant="caption" component="div" sx={{ fontFamily: 'IBM Plex Mono' }}>ad {a.id}</Typography></TableCell>
              <TableCell sx={{ whiteSpace: 'normal' }}>{a.accountName}{a.managers && <Typography variant="caption" component="div">{a.managers}</Typography>}</TableCell>
              <TableCell>{a.domain ?? 'Sem domínio'}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{a.spend ? money(a.spend, 'BRL') : '—'}</TableCell>
              <TableCell sx={{ fontFamily: 'IBM Plex Mono', fontSize: 12, whiteSpace: 'normal', overflowWrap: 'anywhere', maxWidth: 320 }}>
                {Object.keys(a.params).length ? Object.entries(a.params).map(([k, v]) => `${k}=${v}`).join('&') : <Typography variant="caption">nenhum utm_*</Typography>}</TableCell>
              <TableCell><StatusTag ad={a} /></TableCell>
            </TableRow>
          ))}
          {!rows.length && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>Nenhum anúncio com esse filtro.</TableCell></TableRow>}
        </TableBody>
      </Table></TableContainer>
      {filtered.length > PAGE_SIZE && (
        <TablePagination component="div" count={filtered.length} page={Math.min(page, pages - 1)} onPageChange={(_, p) => setPage(p)}
          rowsPerPage={PAGE_SIZE} rowsPerPageOptions={[PAGE_SIZE]} labelRowsPerPage="Por página"
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
          getItemAriaLabel={(x) => (x === 'next' ? 'Próxima página' : x === 'previous' ? 'Página anterior' : x === 'first' ? 'Primeira página' : 'Última página')} />
      )}
    </Card>
  );
}
