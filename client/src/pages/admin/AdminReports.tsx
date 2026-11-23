import { Autocomplete, Box, Button, Card, CardHeader, Checkbox, Chip, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, TextField, ToggleButton, ToggleButtonGroup, Typography, useTheme } from '@mui/material';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useFilters } from '@/context/FiltersContext';
import { adminApi } from '@/lib/api/endpoints';
import { int, longDate, money, pct } from '@/lib/format';
import { ErrorBox, PageHead } from '@/components/ui/States';
import type { AdminReportMetrics, AdminReportPlatform, AdminReportRow, Currency } from '@/types/api';

/**
 * 0.18.6 · Administração → Relatórios (só Admin/SuperAdmin; o servidor também responde 403 em /admin/*).
 * Métricas de todas as contas conectadas ao painel, sem conversão de moeda:
 * Meta Ads e Google Ads em R$ (como as contas pagam), Google Ad Manager em US$.
 *  - Por conta: escolhe as contas; linhas = data × conta.
 *  - Por período: todas as contas da plataforma com o total do período.
 * O período é o filtro "Data" do topo.
 */
type Kind = 'money' | 'int' | 'pct' | 'pct2';
interface Col { k: string; label: string; kind: Kind; hint?: string }
const COLS: Record<AdminReportPlatform, Col[]> = {
  meta: [
    { k: 'spend', label: 'Custo', kind: 'money', hint: 'Valor gasto (sem IVA)' }, { k: 'iva', label: 'IVA', kind: 'money' }, { k: 'total', label: 'Custo c/ IVA', kind: 'money' },
    { k: 'impressions', label: 'Impressões', kind: 'int' }, { k: 'cpm', label: 'CPM', kind: 'money' }, { k: 'clicks', label: 'Cliques', kind: 'int' },
    { k: 'linkClicks', label: 'Cliques no link', kind: 'int' }, { k: 'ctr', label: 'CTR (link)', kind: 'pct2' }, { k: 'cpcLink', label: 'CPC-L', kind: 'money' },
    { k: 'results', label: 'Resultados', kind: 'int', hint: 'Conversas por mensagem iniciadas' }, { k: 'cpr', label: 'CPR', kind: 'money' },
    { k: 'leads', label: 'Leads', kind: 'int' }, { k: 'cpl', label: 'CPL', kind: 'money' },
  ],
  'google-ads': [
    { k: 'spend', label: 'Custo', kind: 'money' }, { k: 'impressions', label: 'Impressões', kind: 'int' }, { k: 'cpm', label: 'CPM', kind: 'money' },
    { k: 'clicks', label: 'Cliques', kind: 'int' }, { k: 'ctr', label: 'CTR', kind: 'pct2' }, { k: 'cpc', label: 'CPC', kind: 'money' },
  ],
  gam: [
    { k: 'revenue', label: 'Receita bruta', kind: 'money' }, { k: 'netRevenue', label: 'Receita líquida', kind: 'money', hint: 'Sem o revShare do domínio' },
    { k: 'impressions', label: 'Impressões', kind: 'int' }, { k: 'ecpm', label: 'eCPM', kind: 'money' }, { k: 'adRequests', label: 'Ad Requests', kind: 'int' },
    { k: 'responsesServed', label: 'Respostas servidas', kind: 'int' }, { k: 'fillRate', label: 'Fill Rate', kind: 'pct' }, { k: 'clicks', label: 'Cliques', kind: 'int' },
    { k: 'ctr', label: 'CTR', kind: 'pct2' }, { k: 'cpc', label: 'CPC', kind: 'money' }, { k: 'viewability', label: 'Viewability', kind: 'pct' },
  ],
};
const TITLE: Record<AdminReportPlatform, string> = { meta: 'Meta Ads', 'google-ads': 'Google Ads', gam: 'Google Ad Manager' };
const ACCOUNT_LABEL: Record<AdminReportPlatform, string> = { meta: 'Conta Meta Ads', 'google-ads': 'Conta Google Ads', gam: 'Conta Google Ad Manager' };
const ACCOUNTS_LABEL: Record<AdminReportPlatform, string> = { meta: 'Contas Meta Ads', 'google-ads': 'Contas Google Ads', gam: 'Contas Google Ad Manager' };

const fmt = (kind: Kind, v: number | null | undefined, cur: Currency) =>
  kind === 'money' ? money(v, cur) : kind === 'int' ? int(v) : kind === 'pct2' ? pct(v, 2) : pct(v);
const dmy = (iso: string) => iso.split('-').reverse().join('/');

function csv(platform: AdminReportPlatform, mode: 'account' | 'period', rows: AdminReportRow[], total: AdminReportMetrics) {
  const cols = COLS[platform];
  const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const num = (v: number | null | undefined) => (v == null ? '' : String(Math.round(v * 10000) / 10000).replace('.', ','));
  const head = [...(mode === 'account' ? ['Data'] : []), 'Conta', 'ID', ...cols.map((c) => c.label)];
  const lines = rows.map((r) => [...(mode === 'account' ? [r.date ?? ''] : []), r.accountName, r.externalId, ...cols.map((c) => num(r.metrics[c.k]))]);
  lines.push([...(mode === 'account' ? ['Total'] : []), mode === 'account' ? '' : 'Total', '', ...cols.map((c) => num(total[c.k]))]);
  const blob = new Blob(['﻿' + [head, ...lines].map((l) => l.map((x) => esc(String(x))).join(';')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `relatorio-${platform}-${mode === 'account' ? 'por-conta' : 'por-periodo'}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function AdminReports({ platform }: { platform: AdminReportPlatform }) {
  const { pluto: p } = useTheme();
  const f = useFilters();
  const [mode, setMode] = useState<'account' | 'period'>('period');
  const [picked, setPicked] = useState<string[]>([]);
  const [sort, setSort] = useState<{ k: string; d: 'asc' | 'desc' }>({ k: 'key', d: 'desc' });
  const accs = useQuery({ queryKey: ['adminReportAccounts', platform], queryFn: () => adminApi.reportAccounts(platform), staleTime: 5 * 60_000 });
  const q = { mode, from: f.from, to: f.to, accounts: mode === 'account' ? picked.join(',') : undefined };
  const enabled = mode === 'period' || picked.length > 0;
  const rep = useQuery({ queryKey: ['adminReport', platform, q], queryFn: () => adminApi.report(platform, q), enabled, placeholderData: keepPreviousData });
  const cols = COLS[platform];
  const cur: Currency = platform === 'gam' ? 'USD' : 'BRL';
  const accounts = accs.data?.accounts ?? [];

  const rows = useMemo(() => {
    const list = (rep.data && rep.data.mode === mode ? rep.data.rows : []).slice();
    const dir = sort.d === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      if (sort.k === 'key') return mode === 'account' ? ((a.date ?? '').localeCompare(b.date ?? '') || b.accountName.localeCompare(a.accountName)) * dir : b.accountName.localeCompare(a.accountName) * dir;
      return ((a.metrics[sort.k] ?? -Infinity) - (b.metrics[sort.k] ?? -Infinity)) * dir;
    });
  }, [rep.data, sort, mode]);

  const head = (k: string, label: string, left = false, hint?: string) => (
    <TableCell key={k} align={left ? 'left' : 'right'} title={hint} sx={{ whiteSpace: 'nowrap' }}>
      <TableSortLabel active={sort.k === k} direction={sort.k === k ? sort.d : 'desc'} onClick={() => setSort({ k, d: sort.k === k && sort.d === 'desc' ? 'asc' : 'desc' })}>{label}</TableSortLabel>
    </TableCell>
  );
  const period = f.from === f.to ? longDate(f.from) : `${longDate(f.from)} – ${longDate(f.to)}`;
  const data = rep.data && rep.data.mode === mode ? rep.data : null;

  return (
    <>
      <PageHead crumb="Administração · Relatórios" title={TITLE[platform]}
        sub={`${period} · valores em ${cur === 'BRL' ? 'R$ (moeda das contas)' : 'US$ (moeda do Ad Manager)'} · todas as contas conectadas ao painel`}
        right={<Button variant="outlined" startIcon={<FileDownloadOutlinedIcon />} disabled={!data?.rows.length} onClick={() => data && csv(platform, mode, rows, data.total)}>Exportar CSV</Button>} />
      <Card sx={{ mb: 1.75 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ p: 2, alignItems: { md: 'center' } }}>
          <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && setMode(v)} aria-label="Tipo de relatório">
            <ToggleButton value="account">Por conta</ToggleButton>
            <ToggleButton value="period">Por período</ToggleButton>
          </ToggleButtonGroup>
          {mode === 'account' && (
            <Autocomplete multiple size="small" disableCloseOnSelect sx={{ flex: 1, minWidth: 260 }} loading={accs.isLoading}
              options={accounts.map((a) => a.id)} value={picked} onChange={(_, v) => setPicked(v)}
              getOptionLabel={(id) => accounts.find((a) => a.id === id)?.name ?? id}
              renderOption={(props, id, { selected }) => { const a = accounts.find((x) => x.id === id); const { key, ...rest } = props as typeof props & { key: string };
                return <li key={key} {...rest}><Checkbox size="small" checked={selected} sx={{ mr: 1, p: 0.5 }} /><Box><Typography sx={{ fontSize: 13.5 }}>{a?.name}</Typography><Typography variant="caption">{a?.externalId}{a && !a.imported ? ' · não importada' : ''}</Typography></Box></li>; }}
              renderValue={(v, getItemProps) => v.map((id, i) => { const { key, ...rest } = getItemProps({ index: i }); return <Chip key={key} size="small" label={accounts.find((a) => a.id === id)?.name ?? id} {...rest} />; })}
              renderInput={(params) => <TextField {...params} label={ACCOUNTS_LABEL[platform]} placeholder={picked.length ? '' : 'Escolha as contas'} />} />
          )}
          {mode === 'account' && <Button size="small" onClick={() => setPicked(picked.length === accounts.length ? [] : accounts.map((a) => a.id))}>{picked.length === accounts.length && accounts.length ? 'Limpar' : 'Todas'}</Button>}
          {mode === 'period' && <Typography variant="caption">Todas as {accounts.length || ''} contas {TITLE[platform]} com as métricas do período (contas sem dados aparecem zeradas).</Typography>}
        </Stack>
      </Card>
      <Card>
        <CardHeader title={mode === 'account' ? `Por conta · data × ${ACCOUNT_LABEL[platform]}` : 'Por período · todas as contas'}
          subheader={data ? `${data.rows.length} linha${data.rows.length === 1 ? '' : 's'} · ${period}` : period} />
        {accs.error ? <Box sx={{ p: 2 }}><ErrorBox error={accs.error} retry={() => accs.refetch()} /></Box>
          : rep.error && !data ? <Box sx={{ p: 2 }}><ErrorBox error={rep.error} retry={() => rep.refetch()} /></Box>
          : !enabled ? <Typography sx={{ p: 3, color: 'text.disabled', textAlign: 'center' }}>Escolha uma ou mais contas para ver as métricas por data.</Typography>
          : !data ? <Box sx={{ p: 2 }}><Skeleton variant="rounded" height={260} /></Box>
          : (
            <TableContainer>
              <Table size="small" sx={{ '& td, & th': { px: 1.1, py: 1.1 } }}>
                <TableHead>
                  <TableRow>
                    {mode === 'account' && head('key', 'Data', true)}
                    {mode === 'account' ? <TableCell sx={{ whiteSpace: 'nowrap' }}>{ACCOUNT_LABEL[platform]}</TableCell> : head('key', ACCOUNT_LABEL[platform], true)}
                    {cols.map((c) => head(c.k, c.label, false, c.hint))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow sx={{ '& > td': { bgcolor: `${p.panel2} !important`, fontWeight: 600, borderBottomColor: p.line2 } }}>
                    <TableCell colSpan={mode === 'account' ? 2 : 1}>Total</TableCell>
                    {cols.map((c) => <TableCell key={c.k} align="right" sx={{ whiteSpace: 'nowrap' }}>{fmt(c.kind, data.total[c.k], cur)}</TableCell>)}
                  </TableRow>
                  {rows.map((r) => (
                    <TableRow key={`${r.date ?? ''}|${r.accountId}`} hover>
                      {mode === 'account' && <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.date ? dmy(r.date) : '—'}</TableCell>}
                      <TableCell><Typography sx={{ fontSize: 'inherit' }}>{r.accountName}</Typography><Typography variant="caption">{r.externalId}</Typography></TableCell>
                      {cols.map((c) => <TableCell key={c.k} align="right" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmt(c.kind, r.metrics[c.k], cur)}</TableCell>)}
                    </TableRow>
                  ))}
                  {!rows.length && <TableRow><TableCell colSpan={cols.length + 2} align="center" sx={{ py: 4, color: 'text.disabled' }}>Sem dados no período.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </TableContainer>
          )}
      </Card>
    </>
  );
}
