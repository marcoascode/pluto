import { Alert, Box, Button, Card, CardHeader, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, IconButton, MenuItem, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import AccountBalanceRoundedIcon from '@mui/icons-material/AccountBalanceRounded';
import SwapVertRoundedIcon from '@mui/icons-material/SwapVertRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { Fragment, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useFilters } from '@/context/FiltersContext';
import { useFinanceMutation, useFinanceOverview } from '@/hooks/queries';
import { financeApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { ConfirmDialog, ErrorBox, PageHead, PageSkeleton } from '@/components/ui/States';
import { money, pct0 } from '@/lib/format';
import { CATEGORY, COST_CATEGORIES, ddmmyyyy, monthOptions, monthShort, monthTitle, shiftMonth } from '@/lib/finance';
import { todayISO } from '@/lib/period';
import type { CashCompany, CashInput, Currency, FinanceOverview, MonthClose } from '@/types/api';

const NOW = todayISO().slice(0, 7);
const PRESETS: { key: string; label: string; from: (now: string) => string }[] = [
  { key: '2', label: 'Anterior + atual', from: (n) => shiftMonth(n, -1) },
  { key: '3', label: '3 meses', from: (n) => shiftMonth(n, -2) },
  { key: '6', label: '6 meses', from: (n) => shiftMonth(n, -5) },
  { key: '12', label: '12 meses', from: (n) => shiftMonth(n, -11) },
  { key: 'y', label: 'Ano atual', from: (n) => `${n.slice(0, 4)}-01` },
];

/** Finance → Caixa Empresa: caixa estimado de hoje + fechamento mês a mês (receita dos sites × Google + Meta × custos). */
export default function CashPage() {
  const f = useFilters();
  const [preset, setPreset] = useState('2');
  const [range, setRange] = useState({ from: shiftMonth(NOW, -1), to: NOW });
  const { data, error, refetch } = useFinanceOverview(range.from, range.to);
  const [dialog, setDialog] = useState<'balance' | 'move' | null>(null);
  const pick = (k: string) => { const p = PRESETS.find((x) => x.key === k); if (!p) return; setPreset(k); setRange({ from: p.from(NOW), to: NOW }); };
  if (error && !data) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  const coName = data.selected ? data.companies.find((c) => c.id === data.selected)?.name : null;
  return (
    <>
      <PageHead title="Caixa Empresa" sub={`${coName ?? 'Todas as Empresas'} · valores em ${f.currency} · receita por competência`}
        right={<Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" startIcon={<SwapVertRoundedIcon />} onClick={() => setDialog('move')} disabled={!data.companies.length}>Aporte / retirada</Button>
          <Button size="small" variant="contained" startIcon={<AccountBalanceRoundedIcon />} onClick={() => setDialog('balance')} disabled={!data.companies.length}>Conferir saldo</Button>
        </Stack>} />
      {!data.companies.length ? (
        <Alert severity="info" variant="outlined">Nenhuma Empresa cadastrada. O Finance é por Empresa: cadastre em Usuários &amp; Squads → Empresas e ligue os Squads (domínios) a ela.</Alert>
      ) : (
        <>
          <Grid container spacing={1.75}>
            <Grid size={{ xs: 12, lg: 8 }}><CashCard data={data} onBalance={() => setDialog('balance')} /></Grid>
            <Grid size={{ xs: 12, lg: 4 }}><MonthNow m={data.months.find((x) => x.month === NOW) ?? null} prev={data.months.find((x) => x.month === shiftMonth(NOW, -1)) ?? null} /></Grid>
          </Grid>
          <Card sx={{ mt: 1.75 }}>
            <CardHeader title="Fechamento mensal" subheader="Receita dos sites (Ad Manager, sem revShare) − Google Ads − Meta Ads − IVA − custos lançados" />
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', px: 2, pb: 1.5 }}>
              <Box sx={{ overflowX: 'auto', maxWidth: '100%' }}>
                <ToggleButtonGroup size="small" exclusive value={preset} onChange={(_, v) => v && pick(v)} aria-label="Período">
                  {PRESETS.map((p) => <ToggleButton key={p.key} value={p.key} sx={{ px: 1.25, py: 0.4, fontSize: 12, whiteSpace: 'nowrap' }}>{p.label}</ToggleButton>)}
                </ToggleButtonGroup>
              </Box>
              <MonthSelect label="De" value={range.from} onChange={(v) => { setPreset(''); setRange((r) => ({ from: v, to: v > r.to ? v : r.to })); }} />
              <MonthSelect label="Até" value={range.to} onChange={(v) => { setPreset(''); setRange((r) => ({ to: v, from: v < r.from ? v : r.from })); }} max={NOW} />
            </Stack>
            <CloseTable data={data} />
          </Card>
          {data.outside && (
            <Typography variant="caption" component="p" sx={{ mt: 1.25 }}>
              Fora do Finance no período: domínios sem Empresa (inclusive "Sem domínio") somaram {money(data.outside.revenue, f.currency)} de receita e {money(data.outside.adSpend, f.currency)} de anúncios.
              Ligue os Squads às Empresas em Usuários &amp; Squads para entrarem aqui.
            </Typography>
          )}
          <Entries cash={data.cash.companies} showCompany={!data.selected && data.companies.length > 1} />
        </>
      )}
      {dialog && <CashDialog kind={dialog} data={data} onClose={() => setDialog(null)} />}
    </>
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

/** Caixa estimado hoje com a conta que leva até ele. */
function CashCard({ data, onBalance }: { data: FinanceOverview; onBalance: () => void }) {
  const { pluto: p } = useTheme();
  const { currency } = useFilters();
  const cos = data.cash.companies;
  const one = cos.length === 1 ? cos[0] : null;
  const missing = cos.filter((c) => c.balance == null);
  const total = data.cash.total;
  const line = (l: string, v: number, sign: '+' | '−' | '', tone?: string) => (
    <Stack direction="row" sx={{ justifyContent: 'space-between', py: 0.75, borderBottom: `1px dashed ${p.line}` }}>
      <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{l}</Typography>
      <Typography sx={{ fontSize: 13.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: tone }}>{sign} {money(Math.abs(v), currency)}</Typography>
    </Stack>
  );
  return (
    <Card sx={{ p: 2.25, height: '100%', background: `linear-gradient(135deg, ${alpha(p.pos, 0.1)}, transparent 55%), ${p.panel}` }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <AccountBalanceRoundedIcon sx={{ fontSize: 18, color: p.pos }} />
        <Typography variant="overline" sx={{ color: p.fg2 }}>Caixa estimado hoje</Typography>
      </Stack>
      {total == null ? (
        <Box sx={{ py: 1.5 }}>
          <Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: 22, mb: 0.75 }}>Informe o saldo do banco para começar</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, maxWidth: 520 }}>
            A partir do saldo conferido, o caixa soma a receita dos sites, tira Google, Meta, IVA e os custos lançados, e considera aportes e retiradas.
          </Typography>
          <Button variant="contained" size="small" onClick={onBalance} startIcon={<AccountBalanceRoundedIcon />}>Conferir saldo</Button>
        </Box>
      ) : (
        <>
          <Typography sx={{ fontFamily: 'Sora', fontWeight: 700, fontSize: { xs: 32, md: 40 }, letterSpacing: '-.02em', color: total < 0 ? p.neg : p.fg, my: 0.5, fontVariantNumeric: 'tabular-nums' }}>{money(total, currency)}</Typography>
          {one && one.anchor ? (
            <Box sx={{ mt: 1, maxWidth: 560 }}>
              {line(`Saldo conferido em ${ddmmyyyy(one.anchor.date)}`, one.anchor.amount, '')}
              {line('Resultado desde então (receita − anúncios)', one.resultSince, one.resultSince < 0 ? '−' : '+', one.resultSince < 0 ? p.neg : p.pos)}
              {line('Custos pagos desde então', one.costsSince, '−', one.costsSince ? p.neg : undefined)}
              {(one.deposits > 0 || one.withdrawals > 0) && line('Aportes − retiradas', one.deposits - one.withdrawals, one.deposits - one.withdrawals < 0 ? '−' : '+')}
            </Box>
          ) : (
            <TableContainer sx={{ mt: 1 }}><Table size="small">
              <TableHead><TableRow><TableCell>Empresa</TableCell><TableCell align="right">Saldo conferido</TableCell><TableCell align="right">Resultado</TableCell><TableCell align="right">Custos pagos</TableCell><TableCell align="right">Caixa</TableCell></TableRow></TableHead>
              <TableBody>{cos.map((c) => (
                <TableRow key={c.companyId} sx={{ '& td': { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } }}>
                  <TableCell><b>{c.companyName}</b><Typography variant="caption" component="div" sx={{ color: c.anchor ? undefined : p.warn }}>{c.anchor ? `conferido em ${ddmmyyyy(c.anchor.date)}` : 'sem saldo conferido'}</Typography></TableCell>
                  <TableCell align="right">{c.anchor ? money(c.anchor.amount, currency) : '—'}</TableCell>
                  <TableCell align="right" sx={{ color: c.resultSince < 0 ? p.neg : p.pos }}>{c.anchor ? money(c.resultSince, currency) : '—'}</TableCell>
                  <TableCell align="right">{c.anchor ? money(c.costsSince, currency) : '—'}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{c.balance == null ? '—' : money(c.balance, currency)}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table></TableContainer>
          )}
          {missing.length > 0 && cos.length > 1 && <Typography variant="caption" component="p" sx={{ mt: 1, color: p.warn }}>{missing.map((c) => c.companyName).join(', ')} ainda sem saldo conferido: fora da soma.</Typography>}
          <Typography variant="caption" component="p" sx={{ mt: 1.25 }}>Estimado: a receita do Ad Manager entra no dia em que foi gerada, não no dia do pagamento. Confira o saldo do banco de tempos em tempos para zerar a diferença.</Typography>
        </>
      )}
    </Card>
  );
}

/** Mês atual (parcial) com a comparação com o mês anterior inteiro. */
function MonthNow({ m, prev }: { m: MonthClose | null; prev: MonthClose | null }) {
  const { pluto: p } = useTheme();
  const { currency } = useFilters();
  if (!m) return <Card sx={{ p: 2.25, height: '100%' }}><Typography variant="overline">Este mês</Typography><Typography variant="body2" color="text.secondary">Inclua o mês atual no período para ver o parcial.</Typography></Card>;
  const items: [string, number, string?][] = [['Receita', m.revenue, p.rev], ['Anúncios (Google + Meta + IVA)', -m.adSpend, p.spend], ['Custos lançados', -m.costs, p.warn]];
  const max = Math.max(m.revenue, m.adSpend + m.costs, 1);
  return (
    <Card sx={{ p: 2.25, height: '100%' }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="overline">{monthTitle(m.month)} · parcial</Typography>
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

/** Tabela do fechamento: um mês por linha, abre a quebra dos custos por categoria e por Empresa. */
function CloseTable({ data }: { data: FinanceOverview }) {
  const { pluto: p } = useTheme();
  const { currency } = useFilters();
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
  return (
    <TableContainer>
      <Table size="small" sx={{ '& td, & th': { py: 1.1 } }}>
        <TableHead><TableRow>
          <TableCell>Mês</TableCell>
          {['Receita', 'Google Ads', 'Meta Ads', 'IVA', 'Custos', 'Resultado', 'Margem'].map((h) => <TableCell key={h} align="right">{h}</TableCell>)}
        </TableRow></TableHead>
        <TableBody>
          <TableRow sx={{ '& td': { bgcolor: p.panel2, fontWeight: 700 } }}>
            <TableCell>Total · {months.length} {months.length === 1 ? 'mês' : 'meses'}</TableCell>
            <TableCell align="right" sx={num}>{money(data.totals.revenue, currency)}</TableCell>
            <TableCell align="right" sx={num}>{money(data.totals.googleSpend, currency)}</TableCell>
            <TableCell align="right" sx={num}>{money(data.totals.metaSpend, currency)}</TableCell>
            <TableCell align="right" sx={num}>{money(data.totals.iva, currency)}</TableCell>
            <TableCell align="right" sx={num}>{money(data.totals.costs, currency)}</TableCell>
            <TableCell align="right" sx={num}>{resultCell(data.totals.result, true)}</TableCell>
            <TableCell align="right">{pct0(data.totals.margin)}</TableCell>
          </TableRow>
          {months.map((m) => {
            const isOpen = open.has(m.month);
            const cats = COST_CATEGORIES.filter((c) => m.costsByCategory[c.key]);
            return (
              <Fragment key={m.month}>
                <TableRow hover sx={{ cursor: 'pointer' }} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(m.month)) n.delete(m.month); else n.add(m.month); return n; })}>
                  <TableCell>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                      <ChevronRightRoundedIcon sx={{ fontSize: 18, color: 'text.disabled', transform: isOpen ? 'rotate(90deg)' : 'none', transition: '.15s' }} />
                      <Typography sx={{ fontWeight: 600, fontSize: 13.5 }}>{monthTitle(m.month)}</Typography>
                      {m.partial ? <Chip size="small" label="parcial" sx={{ height: 18, fontSize: 11, color: p.warn, bgcolor: alpha(p.warn, 0.15) }} />
                        : <Chip size="small" label="fechado" sx={{ height: 18, fontSize: 11, color: p.fg2, bgcolor: p.panel3 }} />}
                    </Stack>
                  </TableCell>
                  <TableCell align="right" sx={num}>{money(m.revenue, currency)}</TableCell>
                  <TableCell align="right" sx={num}>{money(m.googleSpend, currency)}</TableCell>
                  <TableCell align="right" sx={num}>{money(m.metaSpend, currency)}</TableCell>
                  <TableCell align="right" sx={num}>{money(m.iva, currency)}</TableCell>
                  <TableCell align="right" sx={num}>{money(m.costs, currency)}</TableCell>
                  <TableCell align="right" sx={num}>{resultCell(m.result)}</TableCell>
                  <TableCell align="right">{pct0(m.margin)}</TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow>
                    <TableCell colSpan={8} sx={{ bgcolor: alpha(p.panel2, 0.6), py: 1.5 }}>
                      <Grid container spacing={2}>
                        <Grid size={{ xs: 12, md: showCo ? 6 : 12 }}>
                          <Typography variant="overline">Custos por categoria</Typography>
                          {cats.length ? (
                            <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', mt: 0.5 }}>
                              {cats.map((c) => <Chip key={c.key} size="small" label={`${CATEGORY[c.key].label} · ${money(m.costsByCategory[c.key]!, currency)}`} sx={{ bgcolor: alpha(c.color, 0.14), color: c.color, fontWeight: 600 }} />)}
                            </Stack>
                          ) : <Typography variant="caption" component="div">Nenhum custo lançado neste mês. <RouterLink to="/finance/custos" style={{ color: p.accent }}>Lançar custos</RouterLink></Typography>}
                        </Grid>
                        {showCo && (
                          <Grid size={{ xs: 12, md: 6 }}>
                            <Typography variant="overline">Por Empresa</Typography>
                            {m.companies.map((c) => (
                              <Stack key={c.companyId} direction="row" spacing={1} sx={{ justifyContent: 'space-between', fontSize: 13, py: 0.4 }}>
                                <span>{cos.get(c.companyId)}</span>
                                <Box component="span" sx={{ color: 'text.secondary', ...num }}>receita {money(c.revenue, currency)} · anúncios {money(c.adSpend, currency)} · custos {money(c.costs, currency)} · <b style={{ color: c.result < 0 ? p.neg : p.pos }}>{money(c.result, currency)}</b></Box>
                              </Stack>
                            ))}
                          </Grid>
                        )}
                      </Grid>
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

const KIND_LABEL = { balance: 'Saldo conferido', deposit: 'Aporte', withdrawal: 'Retirada' } as const;

/** Lançamentos do caixa (saldos conferidos, aportes, retiradas). */
function Entries({ cash, showCompany }: { cash: CashCompany[]; showCompany: boolean }) {
  const { pluto: p } = useTheme();
  const { currency } = useFilters();
  const [del, setDel] = useState<{ id: string; label: string } | null>(null);
  const remove = useFinanceMutation(financeApi.deleteCash);
  const rows = cash.flatMap((c) => c.entries.map((e) => ({ ...e, company: c.companyName }))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  if (!rows.length) return null;
  return (
    <Card sx={{ mt: 1.75 }}>
      <CardHeader title="Lançamentos do caixa" subheader="Saldos conferidos no banco, aportes e retiradas" />
      <TableContainer><Table size="small">
        <TableHead><TableRow><TableCell>Data</TableCell>{showCompany && <TableCell>Empresa</TableCell>}<TableCell>Tipo</TableCell><TableCell>Observação</TableCell><TableCell align="right">Valor</TableCell><TableCell /></TableRow></TableHead>
        <TableBody>{rows.map((e) => (
          <TableRow key={e.id}>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>{ddmmyyyy(e.date)}</TableCell>
            {showCompany && <TableCell>{e.company}</TableCell>}
            <TableCell><Chip size="small" label={KIND_LABEL[e.kind]} sx={{ height: 20, fontSize: 11.5, color: e.kind === 'withdrawal' ? p.neg : e.kind === 'deposit' ? p.pos : p.accent, bgcolor: alpha(e.kind === 'withdrawal' ? p.neg : e.kind === 'deposit' ? p.pos : p.accent, 0.14) }} /></TableCell>
            <TableCell sx={{ color: 'text.secondary', whiteSpace: 'normal' }}>{e.note || '—'}{e.createdBy && <Typography variant="caption" component="span"> · {e.createdBy}</Typography>}</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {e.kind === 'withdrawal' ? '− ' : e.kind === 'deposit' ? '+ ' : ''}{money(e.converted, currency)}
              {e.currency !== currency && <Typography variant="caption" component="div">{money(e.amount, e.currency)}</Typography>}
            </TableCell>
            <TableCell align="right"><Tooltip title="Excluir lançamento"><IconButton size="small" onClick={() => setDel({ id: e.id, label: `${KIND_LABEL[e.kind]} de ${ddmmyyyy(e.date)}` })} aria-label="Excluir lançamento"><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip></TableCell>
          </TableRow>
        ))}</TableBody>
      </Table></TableContainer>
      <ConfirmDialog open={!!del} title="Excluir lançamento?" busy={remove.isPending} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id, { onSuccess: () => setDel(null) })}>
        <b>{del?.label}</b> sai do caixa. Se era o último saldo conferido, o caixa passa a contar a partir do anterior.
      </ConfirmDialog>
    </Card>
  );
}

/** Conferir saldo (valor do banco hoje/numa data) ou lançar aporte/retirada. */
function CashDialog({ kind, data, onClose }: { kind: 'balance' | 'move'; data: FinanceOverview; onClose: () => void }) {
  const { currency } = useFilters();
  const [f, setF] = useState<CashInput>({ companyId: data.selected ?? data.companies[0]?.id ?? '', date: todayISO(), kind: kind === 'balance' ? 'balance' : 'deposit', amount: 0, currency: currency === 'USD' ? 'BRL' : currency, note: '' });
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState('');
  const save = useFinanceMutation(financeApi.addCash);
  const submit = () => {
    const v = Number(amount.replace(/\./g, '').replace(',', '.'));
    if (!amount.trim() || !isFinite(v)) return setErr('Informe o valor.');
    if (kind === 'move' && v <= 0) return setErr('O valor precisa ser maior que zero.');
    save.mutate({ ...f, amount: v, note: f.note || null }, { onSuccess: onClose, onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.') });
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{kind === 'balance' ? 'Conferir saldo do banco' : 'Aporte ou retirada'}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.75} sx={{ mt: 0.5 }}>
          {kind === 'balance' && <Typography variant="body2" color="text.secondary">O saldo que está no banco no fim do dia escolhido. O caixa passa a contar a partir dele.</Typography>}
          {data.companies.length > 1 && (
            <TextField select size="small" label="Empresa" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
              {data.companies.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
          )}
          {kind === 'move' && (
            <ToggleButtonGroup exclusive size="small" value={f.kind} onChange={(_, v) => v && setF({ ...f, kind: v })} fullWidth>
              <ToggleButton value="deposit">Aporte (entrou)</ToggleButton><ToggleButton value="withdrawal">Retirada (saiu)</ToggleButton>
            </ToggleButtonGroup>
          )}
          <Stack direction="row" spacing={1}>
            <TextField size="small" label={kind === 'balance' ? 'Saldo' : 'Valor'} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus inputMode="decimal" placeholder="0,00" sx={{ flex: 1 }} error={!!err} />
            <TextField select size="small" label="Moeda" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })} sx={{ width: 96 }}>
              {(['BRL', 'USD', 'EUR'] as Currency[]).map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </TextField>
          </Stack>
          <TextField size="small" type="date" label="Data" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: todayISO() } }} />
          <TextField size="small" label="Observação (opcional)" value={f.note ?? ''} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={kind === 'balance' ? 'ex.: extrato Banco X' : 'ex.: distribuição de lucro'} />
          {err && <Alert severity="error" variant="outlined">{err}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={submit} disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button>
      </DialogActions>
    </Dialog>
  );
}
