import { Alert, Autocomplete, Box, Button, Card, CardHeader, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, IconButton, MenuItem, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import AccountBalanceRoundedIcon from '@mui/icons-material/AccountBalanceRounded';
import AddCircleOutlineRoundedIcon from '@mui/icons-material/AddCircleOutlineRounded';
import RemoveCircleOutlineRoundedIcon from '@mui/icons-material/RemoveCircleOutlineRounded';
import SwapVertRoundedIcon from '@mui/icons-material/SwapVertRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Fragment, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useFilters } from '@/context/FiltersContext';
import { FINANCE_CURRENCY, useFinanceMutation } from '@/hooks/queries';
import { ApiError } from '@/lib/api/client';
import { ConfirmDialog, ErrorBox, PageHead, PageSkeleton } from '@/components/ui/States';
import { money, pct0 } from '@/lib/format';
import {
  CATEGORY, COST_CATEGORIES, ENTRY_CAT, ENTRY_KINDS, EXPENSE_CATS, INCOME_CATS, KIND, cashApi, ddmmyyyy, monthOptions, monthShort, monthTitle, shiftMonth,
  type CashCompany, type CashEntry, type CashEntryInput, type CashMonth, type CashOverview, type CostItem, type EntryKind,
} from '@/lib/finance';
import { todayISO } from '@/lib/period';
import { AttachmentsButton, AttachmentsDialog, type AttachmentContext } from './Attachments';
import { DEFAULT_REVSHARE, sitesApi } from '@/lib/financeOps';
import type { Currency } from '@/types/api';

const NOW = todayISO().slice(0, 7);
const PRESETS: { key: string; label: string; from: (now: string) => string }[] = [
  { key: '2', label: 'Anterior + atual', from: (n) => shiftMonth(n, -1) },
  { key: '3', label: '3 meses', from: (n) => shiftMonth(n, -2) },
  { key: '6', label: '6 meses', from: (n) => shiftMonth(n, -5) },
  { key: '12', label: '12 meses', from: (n) => shiftMonth(n, -11) },
  { key: 'y', label: 'Ano atual', from: (n) => `${n.slice(0, 4)}-01` },
];

/** Caixa + fechamento. Chave ['finance', …]: salvar um custo ou um lançamento atualiza esta tela. */
function useCash(from: string, to: string) {
  const { company } = useFilters();
  const currency = FINANCE_CURRENCY;
  const q = { company: company || undefined, from, to, currency };
  return useQuery({ queryKey: ['finance', 'cash', q], queryFn: () => cashApi.overview(q), placeholderData: keepPreviousData, staleTime: 60_000 });
}

/**
 * Finance → Caixa Empresa. É MANUAL: a receita que de fato caiu na conta e os gastos pagos são lançados aqui;
 * os custos da aba Custos entram sozinhos no dia do pagamento. Nada vem do sync das campanhas.
 */
export default function CashPage() {
  const [preset, setPreset] = useState('2');
  const [range, setRange] = useState({ from: shiftMonth(NOW, -1), to: NOW });
  const { data, error, refetch } = useCash(range.from, range.to);
  const [edit, setEdit] = useState<{ kind: EntryKind; entry?: CashEntry } | null>(null);
  const [att, setAtt] = useState<AttachmentContext | null>(null);
  const attach = (e: CashEntry) => setAtt({ entryId: e.id, title: `${KIND[e.kind].short}${e.category ? ' · ' + ENTRY_CAT[e.category] : ''} · ${ddmmyyyy(e.date)}`, amount: e.amount, currency: e.currency });
  const pick = (k: string) => { const p = PRESETS.find((x) => x.key === k); if (!p) return; setPreset(k); setRange({ from: p.from(NOW), to: NOW }); };
  if (error && !data) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  const coName = data.selected ? data.companies.find((c) => c.id === data.selected)?.name : null;
  const add = (kind: EntryKind) => setEdit({ kind });
  return (
    <>
      <PageHead title="Caixa Empresa" sub={`${coName ?? 'Todas as Empresas'} · valores em ${FINANCE_CURRENCY} · lançamentos manuais`}
        right={data.companies.length > 0 && (
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Button size="small" variant="contained" color="success" startIcon={<AddCircleOutlineRoundedIcon />} onClick={() => add('income')}>Receita recebida</Button>
            <Button size="small" variant="contained" color="warning" startIcon={<RemoveCircleOutlineRoundedIcon />} onClick={() => add('expense')}>Gasto pago</Button>
            <Button size="small" variant="outlined" startIcon={<SwapVertRoundedIcon />} onClick={() => add('deposit')}>Aporte / retirada</Button>
            <Button size="small" variant="outlined" startIcon={<AccountBalanceRoundedIcon />} onClick={() => add('balance')}>Conferir saldo</Button>
          </Stack>
        )} />
      {!data.companies.length ? (
        <Alert severity="info" variant="outlined">Nenhuma Empresa cadastrada. Finanças é por Empresa: cadastre em Usuários &amp; Squads → Empresas.</Alert>
      ) : (
        <>
          <HowItWorks />
          <Grid container spacing={1.75}>
            <Grid size={{ xs: 12, lg: 8 }}><CashCard data={data} onBalance={() => add('balance')} /></Grid>
            <Grid size={{ xs: 12, lg: 4 }}><MonthNow m={data.months.find((x) => x.month === NOW) ?? null} prev={data.months.find((x) => x.month === shiftMonth(NOW, -1)) ?? null} /></Grid>
          </Grid>
          <Card sx={{ mt: 1.75 }}>
            <CardHeader title="Fechamento mensal" subheader="Receitas recebidas − gastos pagos − custos fixos (aba Custos) = resultado do mês. Clique no mês para ver os lançamentos." />
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', px: 2, pb: 1.5 }}>
              <Box sx={{ overflowX: 'auto', maxWidth: '100%' }}>
                <ToggleButtonGroup size="small" exclusive value={preset} onChange={(_, v) => v && pick(v)} aria-label="Período">
                  {PRESETS.map((p) => <ToggleButton key={p.key} value={p.key} sx={{ px: 1.25, py: 0.4, fontSize: 12, whiteSpace: 'nowrap' }}>{p.label}</ToggleButton>)}
                </ToggleButtonGroup>
              </Box>
              <MonthSelect label="De" value={range.from} onChange={(v) => { setPreset(''); setRange((r) => ({ from: v, to: v > r.to ? v : r.to })); }} />
              <MonthSelect label="Até" value={range.to} onChange={(v) => { setPreset(''); setRange((r) => ({ to: v, from: v < r.from ? v : r.from })); }} max={NOW} />
            </Stack>
            <CloseTable data={data} onEdit={(e) => setEdit({ kind: e.kind, entry: e })} onAttach={attach} />
          </Card>
          <Entries data={data} onEdit={(e) => setEdit({ kind: e.kind, entry: e })} onAttach={attach} />
        </>
      )}
      {att && <AttachmentsDialog ctx={att} onClose={() => setAtt(null)} />}
      {edit && <EntryDialog key={edit.entry?.id ?? edit.kind} initialKind={edit.kind} entry={edit.entry} data={data} onClose={() => setEdit(null)} />}
    </>
  );
}

/** Faixa curta que deixa claro de onde vêm os números. */
function HowItWorks() {
  const { pluto: p } = useTheme();
  const items: [string, string, string][] = [
    ['+', 'Receita recebida', 'o que caiu na conta'],
    ['−', 'Gastos pagos', 'faturas Google Ads / Meta'],
    ['−', 'Custos fixos', 'entram sozinhos todo mês (aba Custos)'],
    ['=', 'Caixa', 'atualiza a cada lançamento'],
  ];
  return (
    <Card sx={{ p: 1.5, mb: 1.75, bgcolor: alpha(p.accent, 0.06), borderColor: alpha(p.accent, 0.35) }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 1, md: 2 }} sx={{ alignItems: { md: 'center' } }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
          <InfoOutlinedIcon sx={{ fontSize: 18, color: p.accent }} />
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>Como o caixa anda</Typography>
        </Stack>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', flex: 1 }}>
          {items.map(([s, l, d]) => (
            <Stack key={l} direction="row" spacing={0.75} sx={{ alignItems: 'baseline', px: 1.25, py: 0.5, borderRadius: 2, bgcolor: p.panel2 }}>
              <Typography sx={{ fontFamily: 'Sora', fontWeight: 700, color: s === '+' ? p.pos : s === '=' ? p.accent : p.neg }}>{s}</Typography>
              <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{l}</Typography>
              <Typography variant="caption">{d}</Typography>
            </Stack>
          ))}
        </Stack>
      </Stack>
      <Typography variant="caption" component="p" sx={{ mt: 1 }}>
        Cada receita lançada soma no caixa; cada gasto (Google Ads, Meta, outros) e cada custo fixo diminui. Editou ou excluiu? O caixa acompanha na hora. Os custos fixos aparecem no mês, como linhas automáticas.
      </Typography>
    </Card>
  );
}

function MonthSelect({ label, value, onChange, max }: { label: string; value: string; onChange: (v: string) => void; max?: string }) {
  const opts = useMemo(() => monthOptions(36, 0).filter((m) => !max || m <= max), [max]);
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <Typography variant="caption">{label}</Typography>
      <Select size="small" value={value} onChange={(e) => onChange(e.target.value)} inputProps={{ 'aria-label': `Mês ${label.toLowerCase()}` }} sx={{ minWidth: 118 }}>
        {opts.map((m) => <MenuItem key={m} value={m}>{monthShort(m)}</MenuItem>)}
      </Select>
    </Stack>
  );
}

/** Caixa de hoje com a conta que leva até ele. */
function CashCard({ data, onBalance }: { data: CashOverview; onBalance: () => void }) {
  const { pluto: p } = useTheme();
  const currency = FINANCE_CURRENCY;
  const cos = data.cash.companies;
  const one = cos.length === 1 ? cos[0] : null;
  const total = data.cash.total ?? 0;
  const line = (l: string, v: number, sign: '+' | '−' | '', tone?: string, hint?: string) => (
    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', py: 0.75, borderBottom: `1px dashed ${p.line}` }}>
      <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{l}{hint && <Typography component="span" variant="caption"> · {hint}</Typography>}</Typography>
      <Typography sx={{ fontSize: 13.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: tone, whiteSpace: 'nowrap' }}>{sign} {money(Math.abs(v), currency)}</Typography>
    </Stack>
  );
  return (
    <Card sx={{ p: 2.25, height: '100%', background: `linear-gradient(135deg, ${alpha(p.pos, 0.1)}, transparent 55%), ${p.panel}` }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <AccountBalanceRoundedIcon sx={{ fontSize: 18, color: p.pos }} />
        <Typography variant="overline" sx={{ color: p.fg2 }}>Caixa hoje</Typography>
      </Stack>
      {(
        <>
          <Typography sx={{ fontFamily: 'Sora', fontWeight: 700, fontSize: { xs: 32, md: 40 }, letterSpacing: '-.02em', color: total < 0 ? p.neg : p.fg, my: 0.5, fontVariantNumeric: 'tabular-nums' }}>{money(total, currency)}</Typography>
          {one ? (
            <Box sx={{ mt: 1, maxWidth: 580 }}>
              {one.anchor ? line(`Saldo conferido em ${ddmmyyyy(one.anchor.date)}`, one.anchor.amount, '') : line(`Início do caixa em ${ddmmyyyy(one.since ?? '')}`, 0, '', undefined, 'sem saldo conferido')}
              {line('Receitas recebidas', one.income, '+', p.pos, one.anchor ? 'desde o saldo' : 'desde o início')}
              {line('Gastos pagos', one.expenses, '−', one.expenses ? p.neg : undefined, 'Google Ads, Meta…')}
              {line('Custos fixos pagos', one.costsSince, '−', one.costsSince ? p.neg : undefined, 'da aba Custos')}
              {(one.deposits > 0 || one.withdrawals > 0) && line('Aportes − retiradas', one.deposits - one.withdrawals, one.deposits - one.withdrawals < 0 ? '−' : '+')}
            </Box>
          ) : (
            <TableContainer sx={{ mt: 1, overflowX: 'auto' }}><Table size="small" sx={{ '& td, & th': { px: 1, fontSize: 13 }, '& td:first-of-type, & th:first-of-type': { pl: 0 }, '& td:last-of-type, & th:last-of-type': { pr: 0 } }}>
              <TableHead><TableRow><TableCell>Empresa</TableCell><TableCell align="right">Saldo conferido</TableCell><TableCell align="right">Receitas</TableCell><TableCell align="right">Gastos</TableCell><TableCell align="right">Custos fixos</TableCell><TableCell align="right">Caixa</TableCell></TableRow></TableHead>
              <TableBody>{cos.map((c) => (
                <TableRow key={c.companyId} sx={{ '& td': { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } }}>
                  <TableCell><b>{c.companyName}</b><Typography variant="caption" component="div">{c.anchor ? `conferido em ${ddmmyyyy(c.anchor.date)}` : `desde ${ddmmyyyy(c.since ?? '')} (sem saldo conferido)`}</Typography></TableCell>
                  <TableCell align="right">{money(c.anchor?.amount ?? 0, currency)}</TableCell>
                  <TableCell align="right" sx={{ color: p.pos }}>+ {money(c.income, currency)}</TableCell>
                  <TableCell align="right">− {money(c.expenses, currency)}</TableCell>
                  <TableCell align="right">− {money(c.costsSince, currency)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{money(c.balance ?? 0, currency)}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table></TableContainer>
          )}
          <Typography variant="caption" component="p" sx={{ mt: 1.25 }}>
            Sem saldo conferido, o caixa parte de R$ 0 no mês do primeiro lançamento. <Box component="span" onClick={onBalance} sx={{ color: p.accent, cursor: 'pointer', fontWeight: 600 }}>Conferir saldo</Box> acerta a base com o extrato do banco.
          </Typography>
        </>
      )}
    </Card>
  );
}

/** Mês atual até hoje, comparado com o resultado do mês anterior. */
function MonthNow({ m, prev }: { m: CashMonth | null; prev: CashMonth | null }) {
  const { pluto: p } = useTheme();
  const currency = FINANCE_CURRENCY;
  if (!m) return <Card sx={{ p: 2.25, height: '100%' }}><Typography variant="overline">Este mês</Typography><Typography variant="body2" color="text.secondary">Inclua o mês atual no período para ver o parcial.</Typography></Card>;
  const items: [string, number, string][] = [['Receitas recebidas', m.income, p.pos], ['Gastos pagos', -m.expenses, p.spend], ['Custos fixos', -m.costs, p.warn]];
  const max = Math.max(m.income, m.expenses, m.costs, 1);
  return (
    <Card sx={{ p: 2.25, height: '100%' }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="overline">{monthTitle(m.month)}</Typography>
        <Chip size="small" label="até hoje" sx={{ height: 20, fontSize: 11, color: p.warn, bgcolor: alpha(p.warn, 0.14) }} />
      </Stack>
      <Stack spacing={1.1} sx={{ mt: 1.25 }}>
        {items.map(([l, v, c]) => (
          <Box key={l}>
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{l}</Typography><Typography sx={{ fontSize: 13.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money(v, currency)}</Typography></Stack>
            <Box sx={{ height: 6, borderRadius: 3, bgcolor: p.panel3, mt: 0.5, overflow: 'hidden' }}><Box sx={{ width: `${(Math.abs(v) / max) * 100}%`, height: '100%', bgcolor: c }} /></Box>
          </Box>
        ))}
      </Stack>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mt: 1.75, pt: 1.25, borderTop: 1, borderColor: 'divider' }}>
        <Typography sx={{ fontWeight: 600 }}>Resultado</Typography>
        <Box sx={{ textAlign: 'right' }}>
          <Typography sx={{ fontFamily: 'Sora', fontWeight: 700, fontSize: 24, color: m.result < 0 ? p.neg : p.pos, fontVariantNumeric: 'tabular-nums' }}>{money(m.result, currency)}</Typography>
          <Typography variant="caption">margem {pct0(m.margin)}{prev ? ` · ${monthShort(prev.month)}: ${money(prev.result, currency)}` : ''}</Typography>
        </Box>
      </Stack>
    </Card>
  );
}

/** Linha automática do custo fixo no caixa (vem da aba Custos; edita-se lá). */
function CostLine({ c, showCo, coName }: { c: CostItem; showCo: boolean; coName?: string }) {
  const { pluto: p } = useTheme();
  const currency = FINANCE_CURRENCY;
  const tone = CATEGORY[c.category]?.color ?? p.warn;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', py: 0.5, borderBottom: `1px dashed ${p.line}`, opacity: c.paid ? 1 : 0.6 }}>
      <Typography sx={{ fontSize: 12.5, width: 44, flexShrink: 0, color: 'text.secondary' }}>{ddmmyyyy(c.payDate).slice(0, 5)}</Typography>
      <Chip size="small" label="Custo fixo" sx={{ height: 20, fontSize: 11.5, fontWeight: 600, color: tone, bgcolor: alpha(tone, 0.14) }} />
      <Typography sx={{ fontSize: 13, flex: 1, minWidth: 0 }} noWrap>
        {c.name}{c.site ? <Typography component="span" sx={{ fontSize: 12.5, color: p.accent }}> · {c.site}</Typography> : null}
        <Typography component="span" variant="caption"> · {c.actual ? 'valor da NF' : c.paid ? 'valor do plano' : 'a pagar'}</Typography>
        {showCo && coName && <Typography component="span" variant="caption"> · {coName}</Typography>}
      </Typography>
      <Typography sx={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>− {money(c.converted, currency)}</Typography>
      <Tooltip title="Editar na aba Custos"><IconButton size="small" component={RouterLink} to="/finance/custos" aria-label="Abrir Custos"><OpenInNewRoundedIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
    </Stack>
  );
}

const kindChip = (k: EntryKind) => {
  const d = KIND[k];
  return <Chip size="small" label={d.short} sx={{ height: 20, fontSize: 11.5, fontWeight: 600, color: d.color, bgcolor: alpha(d.color, 0.14) }} />;
};
/** Valor com sinal: + receita/aporte · − gasto/retirada · saldo conferido sem sinal. */
const signed = (e: CashEntry, cur: Currency) => `${KIND[e.kind].sign === '=' ? '' : KIND[e.kind].sign + ' '}${money(e.converted, cur)}`;

/** Fechamento: um mês por linha; abre os lançamentos do mês e os custos fixos por categoria. */
function CloseTable({ data, onEdit, onAttach }: { data: CashOverview; onEdit: (e: CashEntry) => void; onAttach: (e: CashEntry) => void }) {
  const { pluto: p } = useTheme();
  const currency = FINANCE_CURRENCY;
  const [open, setOpen] = useState<Set<string>>(new Set([NOW]));
  const months = data.months.slice().reverse();
  const cos = new Map(data.companies.map((c) => [c.id, c.name]));
  const showCo = !data.selected && data.companies.length > 1;
  const maxAbs = Math.max(1, ...months.map((m) => Math.abs(m.result)));
  const num = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;
  const resultCell = (v: number, bold?: boolean) => (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
      <Box component="span" sx={{ color: v < 0 ? p.neg : p.pos, fontWeight: bold ? 700 : 600 }}>{money(v, currency)}</Box>
      <Box sx={{ width: 44, height: 6, borderRadius: 3, bgcolor: p.panel3, overflow: 'hidden', display: { xs: 'none', md: 'block' } }}><Box sx={{ width: `${(Math.abs(v) / maxAbs) * 100}%`, height: '100%', bgcolor: v < 0 ? p.neg : p.pos }} /></Box>
    </Stack>
  );
  const T = data.totals;
  return (
    <TableContainer>
      <Table size="small" sx={{ '& td, & th': { py: 1.1 } }}>
        <TableHead><TableRow>
          <TableCell>Mês</TableCell>
          {['Receitas recebidas', 'Google Ads', 'Meta Ads', 'Outros gastos', 'Custos fixos', 'Resultado', 'Margem'].map((h) => <TableCell key={h} align="right">{h}</TableCell>)}
        </TableRow></TableHead>
        <TableBody>
          <TableRow sx={{ '& td': { bgcolor: p.panel2, fontWeight: 700 } }}>
            <TableCell>Total · {months.length} {months.length === 1 ? 'mês' : 'meses'}</TableCell>
            <TableCell align="right" sx={{ ...num, color: p.pos }}>{money(T.income, currency)}</TableCell>
            <TableCell align="right" sx={num}>{money(T.googleAds, currency)}</TableCell>
            <TableCell align="right" sx={num}>{money(T.metaAds, currency)}</TableCell>
            <TableCell align="right" sx={num}>{money(T.otherExpense, currency)}</TableCell>
            <TableCell align="right" sx={num}>{money(T.costs, currency)}</TableCell>
            <TableCell align="right" sx={num}>{resultCell(T.result, true)}</TableCell>
            <TableCell align="right">{pct0(T.margin)}</TableCell>
          </TableRow>
          {months.map((m) => {
            const isOpen = open.has(m.month);
            const cats = COST_CATEGORIES.filter((c) => m.costsByCategory[c.key]);
            const empty = !m.entries.length && !m.costs;
            return (
              <Fragment key={m.month}>
                <TableRow hover sx={{ cursor: 'pointer' }} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(m.month)) n.delete(m.month); else n.add(m.month); return n; })} aria-expanded={isOpen}>
                  <TableCell>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                      <ChevronRightRoundedIcon sx={{ fontSize: 18, color: 'text.disabled', transform: isOpen ? 'rotate(90deg)' : 'none', transition: '.15s' }} />
                      <Typography sx={{ fontWeight: 600, fontSize: 13.5 }}>{monthTitle(m.month)}</Typography>
                      {m.partial ? <Chip size="small" label="em andamento" sx={{ height: 18, fontSize: 11, color: p.warn, bgcolor: alpha(p.warn, 0.15) }} />
                        : <Chip size="small" label="fechado" sx={{ height: 18, fontSize: 11, color: p.fg2, bgcolor: p.panel3 }} />}
                    </Stack>
                  </TableCell>
                  <TableCell align="right" sx={{ ...num, color: m.income ? p.pos : undefined }}>{money(m.income, currency)}</TableCell>
                  <TableCell align="right" sx={num}>{money(m.googleAds, currency)}</TableCell>
                  <TableCell align="right" sx={num}>{money(m.metaAds, currency)}</TableCell>
                  <TableCell align="right" sx={num}>{money(m.otherExpense, currency)}</TableCell>
                  <TableCell align="right" sx={num}>{money(m.costs, currency)}</TableCell>
                  <TableCell align="right" sx={num}>{resultCell(m.result)}</TableCell>
                  <TableCell align="right">{pct0(m.margin)}</TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow>
                    <TableCell colSpan={8} sx={{ bgcolor: alpha(p.panel2, 0.6), py: 1.5 }}>
                      {empty ? <Typography variant="caption">Nenhum lançamento nem custo neste mês. Use os botões do topo para lançar a receita recebida e os gastos pagos.</Typography> : (
                        <Grid container spacing={2}>
                          <Grid size={{ xs: 12, md: 7 }}>
                            <Typography variant="overline">Lançamentos do mês</Typography>
                            {(m.costItems ?? []).map((c) => <CostLine key={'k' + c.costId} c={c} showCo={showCo} coName={cos.get(c.companyId)} />)}
                            {m.entries.length ? m.entries.map((e) => (
                              <Stack key={e.id} direction="row" spacing={1} sx={{ alignItems: 'center', py: 0.5, borderBottom: `1px dashed ${p.line}` }}>
                                <Typography sx={{ fontSize: 12.5, width: 44, flexShrink: 0, color: 'text.secondary' }}>{ddmmyyyy(e.date).slice(0, 5)}</Typography>
                                {kindChip(e.kind)}
                                <Typography sx={{ fontSize: 13, flex: 1, minWidth: 0 }} noWrap>{e.category ? ENTRY_CAT[e.category] : KIND[e.kind].label}{e.site ? <Typography component="span" sx={{ fontSize: 12.5, color: p.accent }}> · {e.site}</Typography> : null}{e.note ? <Typography component="span" variant="caption"> · {e.note}</Typography> : null}{showCo && <Typography component="span" variant="caption"> · {cos.get(e.companyId)}</Typography>}</Typography>
                                <Typography sx={{ fontSize: 13, fontWeight: 600, ...num }}>{signed(e, currency)}</Typography>
                                <AttachmentsButton count={e.attachments} required={e.kind === 'expense'} onClick={() => onAttach(e)} />
                                <IconButton size="small" onClick={(ev) => { ev.stopPropagation(); onEdit(e); }} aria-label="Editar lançamento"><EditOutlinedIcon sx={{ fontSize: 16 }} /></IconButton>
                              </Stack>
                            )) : <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>Nenhuma receita ou gasto lançado neste mês.</Typography>}
                          </Grid>
                          <Grid size={{ xs: 12, md: 5 }}>
                            <Typography variant="overline">Custos fixos por categoria</Typography>
                            {cats.length ? (
                              <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', mt: 0.5 }}>
                                {cats.map((c) => <Chip key={c.key} size="small" label={`${CATEGORY[c.key].label} · ${money(m.costsByCategory[c.key]!, currency)}`} sx={{ bgcolor: alpha(c.color, 0.14), color: c.color, fontWeight: 600 }} />)}
                              </Stack>
                            ) : <Typography variant="caption" component="div">Nenhum custo neste mês. <RouterLink to="/finance/custos" style={{ color: p.accent }}>Lançar custos</RouterLink></Typography>}
                            {(m.deposits > 0 || m.withdrawals > 0) && <Typography variant="caption" component="div" sx={{ mt: 1 }}>Aportes {money(m.deposits, currency)} · retiradas {money(m.withdrawals, currency)} (mexem no caixa, não no resultado)</Typography>}
                            {showCo && (
                              <Box sx={{ mt: 1.25 }}>
                                <Typography variant="overline">Por Empresa</Typography>
                                {m.companies.map((c) => (
                                  <Stack key={c.companyId} direction="row" spacing={1} sx={{ justifyContent: 'space-between', fontSize: 13, py: 0.3 }}>
                                    <span>{cos.get(c.companyId)}</span>
                                    <b style={{ color: c.result < 0 ? p.neg : p.pos, fontVariantNumeric: 'tabular-nums' }}>{money(c.result, currency)}</b>
                                  </Stack>
                                ))}
                              </Box>
                            )}
                          </Grid>
                        </Grid>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

type Filter = 'all' | 'income' | 'expense' | 'costs' | 'moves' | 'balance';
const FILTERS: { key: Filter; label: string; kinds: EntryKind[] }[] = [
  { key: 'all', label: 'Todos', kinds: ['income', 'expense', 'deposit', 'withdrawal', 'balance'] },
  { key: 'income', label: 'Receitas', kinds: ['income'] },
  { key: 'expense', label: 'Gastos', kinds: ['expense'] },
  { key: 'costs', label: 'Custos fixos', kinds: [] },
  { key: 'moves', label: 'Aportes e retiradas', kinds: ['deposit', 'withdrawal'] },
  { key: 'balance', label: 'Saldos', kinds: ['balance'] },
];

/** Todos os lançamentos manuais (últimos 50 por Empresa), com filtro, editar e excluir. */
function Entries({ data, onEdit, onAttach }: { data: CashOverview; onEdit: (e: CashEntry) => void; onAttach: (e: CashEntry) => void }) {
  const { pluto: p } = useTheme();
  const currency = FINANCE_CURRENCY;
  const [filter, setFilter] = useState<Filter>('all');
  const [del, setDel] = useState<CashEntry | null>(null);
  const remove = useFinanceMutation(cashApi.remove);
  const showCompany = !data.selected && data.companies.length > 1;
  const names = new Map(data.cash.companies.map((c: CashCompany) => [c.companyId, c.companyName]));
  const kinds = FILTERS.find((f) => f.key === filter)!.kinds;
  const all = data.cash.companies.flatMap((c) => c.entries).sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id));
  const rows = all.filter((e) => kinds.includes(e.kind));
  // custos fixos já pagos no período (automáticos, da aba Custos)
  const costRows = data.months.flatMap((m) => m.costItems ?? []).filter((c) => c.paid).sort((a, b) => b.payDate.localeCompare(a.payDate));
  const showCosts = filter === 'all' || filter === 'costs';
  type Row = { t: 'e'; d: string; e: CashEntry } | { t: 'c'; d: string; c: CostItem };
  const merged: Row[] = [...rows.map((e): Row => ({ t: 'e', d: e.date, e })), ...(showCosts ? costRows.map((c): Row => ({ t: 'c', d: c.payDate, c })) : [])].sort((a, b) => b.d.localeCompare(a.d));
  const missingNf = all.filter((e) => e.kind === 'expense' && !e.attachments).length;
  return (
    <Card sx={{ mt: 1.75 }}>
      <CardHeader title="Lançamentos" subheader="Receitas e gastos lançados, mais os custos fixos que entram sozinhos · clique no clipe para anexar a NF (link do Drive ou PDF)"
        action={missingNf > 0 ? <Chip size="small" label={`${missingNf} gasto${missingNf > 1 ? 's' : ''} sem NF`} onClick={() => setFilter('expense')} sx={{ color: p.warn, bgcolor: alpha(p.warn, 0.14), fontWeight: 600 }} /> : undefined} />
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', px: 2, pb: 1.25 }}>
        {FILTERS.map((f) => {
          const n = f.key === 'costs' ? costRows.length : all.filter((e) => f.kinds.includes(e.kind)).length + (f.key === 'all' ? costRows.length : 0);
          return <Chip key={f.key} label={`${f.label} · ${n}`} onClick={() => setFilter(f.key)} color={filter === f.key ? 'primary' : 'default'} variant={filter === f.key ? 'filled' : 'outlined'} size="small" />;
        })}
      </Stack>
      <TableContainer><Table size="small">
        <TableHead><TableRow><TableCell>Data</TableCell>{showCompany && <TableCell>Empresa</TableCell>}<TableCell>Tipo</TableCell><TableCell>Origem / destino</TableCell><TableCell>Site</TableCell><TableCell>Observação</TableCell><TableCell align="right">Valor</TableCell><TableCell align="center">NF</TableCell><TableCell /></TableRow></TableHead>
        <TableBody>
          {merged.map((r) => r.t === 'c' ? (
            <TableRow key={`c${r.c.costId}${r.c.payDate}`} sx={{ '& td': { color: 'text.secondary' } }}>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{ddmmyyyy(r.c.payDate)}</TableCell>
              {showCompany && <TableCell>{names.get(r.c.companyId)}</TableCell>}
              <TableCell><Chip size="small" label="Custo fixo" sx={{ height: 20, fontSize: 11.5, fontWeight: 600, color: p.warn, bgcolor: alpha(p.warn, 0.14) }} /></TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{CATEGORY[r.c.category]?.label ?? '—'}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.c.site ?? <Typography variant="caption">—</Typography>}</TableCell>
              <TableCell sx={{ whiteSpace: 'normal' }}>{r.c.name}<Typography variant="caption" component="span"> · automático ({r.c.actual ? 'valor da NF' : 'valor do plano'})</Typography></TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, whiteSpace: 'nowrap', color: 'text.primary' }}>− {money(r.c.converted, currency)}</TableCell>
              <TableCell />
              <TableCell align="right"><Tooltip title="Editar na aba Custos"><IconButton size="small" component={RouterLink} to="/finance/custos" aria-label="Abrir Custos"><OpenInNewRoundedIcon fontSize="small" /></IconButton></Tooltip></TableCell>
            </TableRow>
          ) : (() => { const e = r.e; return (
            <TableRow key={e.id}>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{ddmmyyyy(e.date)}</TableCell>
              {showCompany && <TableCell>{names.get(e.companyId)}</TableCell>}
              <TableCell>{kindChip(e.kind)}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{e.category ? ENTRY_CAT[e.category] : '—'}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{e.site ?? <Typography variant="caption">—</Typography>}{e.site && e.competence && e.competence !== e.date.slice(0, 7) && <Typography variant="caption" component="div">ref. {monthShort(e.competence)}</Typography>}</TableCell>
              <TableCell sx={{ color: 'text.secondary', whiteSpace: 'normal' }}>{e.note || '—'}{e.createdBy && <Typography variant="caption" component="span"> · {e.createdBy}</Typography>}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {signed(e, currency)}
                {e.currency !== currency && <Typography variant="caption" component="div">{money(e.amount, e.currency)}</Typography>}
                {e.revsharePct != null && e.grossAmount != null && <Typography variant="caption" component="div">bruto {money(e.grossAmount, e.currency)} − {String(e.revsharePct).replace('.', ',')}% revshare</Typography>}
              </TableCell>
              <TableCell align="center">{e.kind === 'balance' ? null : <AttachmentsButton count={e.attachments} required={e.kind === 'expense'} onClick={() => onAttach(e)} />}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                <Tooltip title="Editar"><IconButton size="small" onClick={() => onEdit(e)} aria-label="Editar lançamento"><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Excluir"><IconButton size="small" onClick={() => setDel(e)} aria-label="Excluir lançamento"><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip>
              </TableCell>
            </TableRow>
          ); })())}
          {!merged.length && <TableRow><TableCell colSpan={showCompany ? 9 : 8} align="center" sx={{ py: 4, color: 'text.disabled' }}>{all.length ? 'Nenhum lançamento deste tipo.' : 'Nenhum lançamento ainda. Comece conferindo o saldo do banco.'}</TableCell></TableRow>}
        </TableBody>
      </Table></TableContainer>
      <ConfirmDialog open={!!del} title="Excluir lançamento?" busy={remove.isPending} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id, { onSuccess: () => setDel(null) })}>
        <b>{del ? `${KIND[del.kind].label} de ${ddmmyyyy(del.date)} · ${money(del.converted, currency)}` : ''}</b> sai do caixa e do fechamento.
        {del?.kind === 'balance' && ' O caixa passa a contar a partir do saldo conferido anterior.'}
      </ConfirmDialog>
    </Card>
  );
}

const parseMoney = (s: string) => Number(s.trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));

/** Lançar ou editar: receita recebida, gasto pago, aporte, retirada ou saldo conferido.
 *  0.15: receita/gasto novo pode ser dividido em vários sites (um lançamento por site, salvos juntos). */
function EntryDialog({ initialKind, entry, data, onClose }: { initialKind: EntryKind; entry?: CashEntry; data: CashOverview; onClose: () => void }) {
  const { pluto: p } = useTheme();
  const [f, setF] = useState<CashEntryInput>(entry
    ? { id: entry.id, companyId: entry.companyId, date: entry.date, kind: entry.kind, category: entry.category, amount: entry.amount, currency: entry.currency, note: entry.note ?? '', site: entry.site ?? '', competence: entry.competence ?? null }
    : { companyId: data.selected ?? data.companies[0]?.id ?? '', date: todayISO(), kind: initialKind, category: initialKind === 'income' ? 'adx' : initialKind === 'expense' ? 'google_ads' : null, amount: 0, currency: 'BRL', note: '', site: '',
        // receita do AdX costuma cair no mês seguinte: já sugere "referente ao mês passado"
        competence: initialKind === 'income' ? shiftMonth(todayISO().slice(0, 7), -1) : null });
  const sitesQ = useQuery({ queryKey: ['finance', 'sites'], queryFn: () => sitesApi.list({}) });
  const flow = f.kind === 'income' || f.kind === 'expense';
  const refMonths = useMemo(() => monthOptions(24, 0).filter((m) => m <= f.date.slice(0, 7)), [f.date]);
  const first = entry ? String(entry.grossAmount ?? entry.amount).replace('.', ',') : '';
  const [amount, setAmount] = useState(first);                                   // aporte, retirada, saldo
  const [lines, setLines] = useState<{ site: string; amount: string }[]>([{ site: entry?.site ?? '', amount: first }]);   // receita/gasto por site
  // receita: o valor informado já tem o revshare do parceiro descontado? ('net' = sim · 'gross' = não, o dash desconta)
  const [rsMode, setRsMode] = useState<'net' | 'gross'>(entry?.revsharePct != null ? 'gross' : 'net');
  const [rsPct, setRsPct] = useState(entry?.revsharePct != null ? String(entry.revsharePct).replace('.', ',') : '');
  const siteList = (sitesQ.data?.sites ?? []).filter((s) => s.companyId === f.companyId);
  const pctOf = (site: string) => (rsPct.trim() ? parseMoney(rsPct) : siteList.find((s) => s.site === site.trim().toLowerCase())?.revshare ?? DEFAULT_REVSHARE);
  const vals = lines.map((l) => ({ site: l.site.trim(), gross: parseMoney(l.amount), pct: pctOf(l.site) }));
  const okVals = vals.filter((v) => isFinite(v.gross) && v.gross > 0);
  const discount = f.kind === 'income' && rsMode === 'gross' && okVals.length > 0;
  const netOf = (v: { gross: number; pct: number }) => (discount ? Math.round(v.gross * (1 - v.pct / 100) * 100) / 100 : v.gross);
  const grossTot = okVals.reduce((a, v) => a + v.gross, 0), netTot = okVals.reduce((a, v) => a + netOf(v), 0);
  const pcts = [...new Set(okVals.map((v) => v.pct))];
  const multi = lines.length > 1;
  const [err, setErr] = useState('');
  const save = useFinanceMutation(cashApi.save);
  const split = useFinanceMutation(cashApi.split);
  const busy = save.isPending || split.isPending;
  const setKind = (k: EntryKind) => setF((x) => ({ ...x, kind: k, category: k === 'income' ? (x.kind === 'income' ? x.category : 'adx') : k === 'expense' ? (x.kind === 'expense' ? x.category : 'google_ads') : null }));
  const cats = f.kind === 'income' ? INCOME_CATS : f.kind === 'expense' ? EXPENSE_CATS : null;
  const groups: EntryKind[][] = initialKind === 'deposit' || initialKind === 'withdrawal' ? [['deposit', 'withdrawal']] : [ENTRY_KINDS.map((k) => k.key)];
  const setLine = (i: number, patch: Partial<{ site: string; amount: string }>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const onErr = (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
  const submit = () => {
    setErr('');
    const gross = f.kind === 'income' && rsMode === 'gross';
    if (gross && !(parseMoney(rsPct.trim() || '0') >= 0 && parseMoney(rsPct.trim() || '0') < 100)) return setErr('Informe o % do revshare (entre 0 e 100).');
    if (!flow) {
      const v = parseMoney(amount);
      if (!amount.trim() || !isFinite(v)) return setErr('Informe o valor.');
      if (f.kind !== 'balance' && v <= 0) return setErr('O valor precisa ser maior que zero.');
      return save.mutate({ ...f, amount: v, note: f.note || null, site: null, competence: null, revsharePct: null }, { onSuccess: onClose, onError: onErr });
    }
    if (vals.some((v) => !isFinite(v.gross) || v.gross <= 0)) return setErr(multi ? 'Informe um valor maior que zero em cada site.' : 'Informe o valor.');
    const sites = vals.map((v) => v.site.toLowerCase()).filter(Boolean);
    if (new Set(sites).size !== sites.length) return setErr('O mesmo site aparece duas vezes.');
    const base = { ...f, note: f.note || null, competence: f.competence ?? null };
    if (!multi) return save.mutate({ ...base, amount: vals[0].gross, site: vals[0].site || null, revsharePct: gross ? vals[0].pct : null }, { onSuccess: onClose, onError: onErr });
    const { id: _id, amount: _a, site: _s, ...rest } = base;
    split.mutate({ ...rest, revsharePct: null, lines: vals.map((v) => ({ site: v.site || null, amount: v.gross, revsharePct: gross ? v.pct : null })) }, { onSuccess: onClose, onError: onErr });
  };
  const title = entry ? 'Editar lançamento' : f.kind === 'income' ? 'Lançar receita recebida' : f.kind === 'expense' ? 'Lançar gasto pago' : f.kind === 'balance' ? 'Conferir saldo do banco' : 'Aporte ou retirada';
  const money2 = (v: number) => money(v, f.currency);
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.75} sx={{ mt: 0.5 }}>
          {(entry || groups[0].length === 2) && (
            <ToggleButtonGroup exclusive size="small" value={f.kind} onChange={(_, v) => v && setKind(v)} fullWidth sx={{ flexWrap: 'wrap' }}>
              {(entry ? ENTRY_KINDS.map((k) => k.key) : groups[0]).map((k) => <ToggleButton key={k} value={k} sx={{ fontSize: 12 }}>{KIND[k].short}</ToggleButton>)}
            </ToggleButtonGroup>
          )}
          <Typography variant="body2" color="text.secondary">{KIND[f.kind].hint}</Typography>
          {data.companies.length > 1 && (
            <TextField select size="small" label="Empresa" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
              {data.companies.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
          )}
          {cats && (
            <TextField select size="small" label={f.kind === 'income' ? 'De onde veio' : 'Gasto com'} value={f.category ?? ''} onChange={(e) => setF({ ...f, category: e.target.value as CashEntryInput['category'] })}>
              {cats.map((c) => <MenuItem key={c.key} value={c.key}>{c.label}</MenuItem>)}
            </TextField>
          )}
          {flow ? (
            <Box>
              <Stack spacing={1}>
                {lines.map((l, i) => (
                  <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                    <Autocomplete freeSolo size="small" sx={{ flex: 1.4, minWidth: 0 }} value={l.site} onInputChange={(_, v) => setLine(i, { site: v })}
                      options={siteList.map((s) => s.site).filter((s) => s === l.site || !lines.some((x) => x.site === s))}
                      renderInput={(pr) => <TextField {...pr} label={multi ? `Site ${i + 1}` : 'Site (para Comissões)'} placeholder="dominiox.com" />} />
                    <TextField size="small" label={f.kind === 'income' && rsMode === 'gross' ? 'Valor bruto' : 'Valor'} value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })}
                      autoFocus={i === lines.length - 1} inputMode="decimal" placeholder="0,00" sx={{ flex: 1 }} error={!!err && !(parseMoney(l.amount) > 0)} />
                    {multi && <IconButton size="small" sx={{ mt: 0.5 }} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remover site ${i + 1}`}><CloseRoundedIcon fontSize="small" /></IconButton>}
                  </Stack>
                ))}
              </Stack>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mt: 0.75 }}>
                {!entry ? <Button size="small" startIcon={<AddRoundedIcon />} onClick={() => setLines((ls) => [...ls, { site: '', amount: '' }])}>Adicionar outro site</Button> : <span />}
                {multi && <Typography sx={{ fontSize: 13 }}>Total: <b style={{ fontVariantNumeric: 'tabular-nums' }}>{money2(grossTot)}</b> em {lines.length} sites</Typography>}
              </Stack>
              {multi && <Typography variant="caption" component="div">Salva um lançamento por site, com a mesma data, origem e observação. Cada site vai para Comissões.</Typography>}
            </Box>
          ) : (
            <TextField size="small" label={f.kind === 'balance' ? 'Saldo no banco' : 'Valor'} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus inputMode="decimal" placeholder="0,00" error={!!err} />
          )}
          <Stack direction="row" spacing={1}>
            <TextField select size="small" label="Moeda" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })} sx={{ width: 96 }}>
              {(['BRL', 'USD', 'EUR'] as Currency[]).map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </TextField>
            <TextField size="small" type="date" label={f.kind === 'income' ? 'Data em que caiu na conta' : f.kind === 'expense' ? 'Data do pagamento' : 'Data'} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} sx={{ flex: 1 }} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: todayISO() } }} />
            {flow && (
              <TextField select size="small" label="Referente a" value={f.competence ?? ''} onChange={(e) => setF({ ...f, competence: e.target.value || null })} sx={{ flex: 1 }}
                slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
                <MenuItem value="">mês da data</MenuItem>
                {refMonths.map((m) => <MenuItem key={m} value={m}>{monthShort(m)}</MenuItem>)}
              </TextField>
            )}
          </Stack>
          {f.kind === 'income' && (
            <Box>
              <Typography variant="caption" component="div" sx={{ mb: 0.5 }}>{multi ? 'Os valores acima já têm o revshare do parceiro descontado?' : 'O valor acima já tem o revshare do parceiro descontado?'}</Typography>
              <ToggleButtonGroup exclusive size="small" fullWidth value={rsMode} onChange={(_, v) => v && setRsMode(v)}>
                <ToggleButton value="net" sx={{ fontSize: 12 }}>Sim, já descontado</ToggleButton>
                <ToggleButton value="gross" sx={{ fontSize: 12 }}>Não, descontar agora</ToggleButton>
              </ToggleButtonGroup>
              {rsMode === 'gross' ? (
                <Box sx={{ mt: 1, p: 1.25, borderRadius: 1.5, border: 1, borderColor: 'divider' }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.75 }}>
                    <Typography sx={{ fontSize: 13, flex: 1 }}>Revshare do parceiro</Typography>
                    <TextField size="small" value={rsPct} onChange={(e) => setRsPct(e.target.value)} placeholder={multi ? 'de cada site' : String(pctOf(lines[0].site)).replace('.', ',')} sx={{ width: 120 }}
                      slotProps={{ input: { endAdornment: <Typography variant="caption">%</Typography> } }} />
                  </Stack>
                  {multi && okVals.map((v, i) => (
                    <Stack key={i} direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="caption">{v.site || `site ${i + 1}`} · {String(v.pct).replace('.', ',')}%</Typography>
                      <Typography sx={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>{money2(v.gross)} → {money2(netOf(v))}</Typography>
                    </Stack>
                  ))}
                  <Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography variant="caption">Valor informado (bruto)</Typography><Typography sx={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{okVals.length ? money2(grossTot) : '—'}</Typography></Stack>
                  <Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography variant="caption">− Revshare {pcts.length === 1 ? `${String(Math.round(pcts[0] * 100) / 100).replace('.', ',')}%` : '(% de cada site)'}</Typography><Typography sx={{ fontSize: 13, color: 'warning.main', fontVariantNumeric: 'tabular-nums' }}>{discount ? `− ${money2(grossTot - netTot)}` : '—'}</Typography></Stack>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', borderTop: 1, borderColor: 'divider', mt: 0.5, pt: 0.5 }}><Typography sx={{ fontSize: 13, fontWeight: 700 }}>Entra no caixa</Typography><Typography sx={{ fontSize: 14, fontWeight: 700, color: 'success.main', fontVariantNumeric: 'tabular-nums' }}>{discount ? money2(netTot) : '—'}</Typography></Stack>
                  <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>{rsPct.trim() ? 'Usando o % informado para todos.' : 'Usando o % cadastrado em cada domínio no dash (sem cadastro: 7,5%).'}</Typography>
                </Box>
              ) : (
                <Typography variant="caption" component="div" sx={{ mt: 0.75 }}>O valor entra no caixa como está (é o que caiu no banco), sem descontar de novo.</Typography>
              )}
            </Box>
          )}
          <TextField size="small" label="Observação (opcional)" value={f.note ?? ''} onChange={(e) => setF({ ...f, note: e.target.value })}
            placeholder={f.kind === 'income' ? 'ex.: pagamento AdX de setembro' : f.kind === 'expense' ? 'ex.: fatura cartão final 4821' : f.kind === 'balance' ? 'ex.: extrato Banco X' : 'ex.: distribuição de lucro'} />
          {err && <Alert severity="error" variant="outlined">{err}</Alert>}
          {flow && !err && <Typography variant="caption" sx={{ color: p.fg2 }}>{f.kind === 'income' ? 'Soma no Caixa Empresa assim que salvar.' : 'Sai do Caixa Empresa assim que salvar.'}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={submit} disabled={busy}>{busy ? 'Salvando…' : multi ? `Salvar ${lines.length} lançamentos` : 'Salvar'}</Button>
      </DialogActions>
    </Dialog>
  );
}
