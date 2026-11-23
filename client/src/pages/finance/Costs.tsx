import { Alert, Box, Button, Card, CardHeader, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, IconButton, InputAdornment, MenuItem, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useFilters } from '@/context/FiltersContext';
import { FINANCE_CURRENCY, useFinanceCosts, useFinanceMutation } from '@/hooks/queries';
import { financeApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { ConfirmDialog, ErrorBox, PageHead, PageSkeleton } from '@/components/ui/States';
import { money } from '@/lib/format';
import { attachmentsApi, CATEGORY, costMonthApi, COST_CATEGORIES, monthOptions, monthShort, monthTitle, shiftMonth, type CostRow } from '@/lib/finance';
import { AttachmentsButton, AttachmentsDialog, type AttachmentContext } from './Attachments';
import { todayISO } from '@/lib/period';
import type { CostCategory, Currency, FinanceCompany, FinanceCost, FinanceCostInput } from '@/types/api';

const NOW = todayISO().slice(0, 7);

/** Finance → Custos: custos fixos e avulsos lançados à mão (ferramentas, domínios, hospedagem, equipe…). Entram no fechamento e no caixa. */
export default function CostsPage() {
  const { pluto: p } = useTheme();
  const currency = FINANCE_CURRENCY;
  const [month, setMonth] = useState(NOW);
  const [onlyMonth, setOnlyMonth] = useState(true);
  const [edit, setEdit] = useState<FinanceCost | 'new' | null>(null);
  const [del, setDel] = useState<FinanceCost | null>(null);
  const [att, setAtt] = useState<AttachmentContext | null>(null);
  const [close, setClose] = useState<CostRow | null>(null);
  const [plan, setPlan] = useState<CostRow | null>(null);
  const { data, error, refetch } = useFinanceCosts(month);
  const remove = useFinanceMutation(financeApi.deleteCost);
  const rows = useMemo(() => ((data?.costs ?? []) as CostRow[]).filter((c) => !onlyMonth || c.appliesInMonth).sort((a, b) => (b.monthAmount ?? 0) - (a.monthAmount ?? 0) || a.name.localeCompare(b.name)), [data, onlyMonth]);
  if (error && !data) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  const multi = data.companies.length > 1;
  const cats = COST_CATEGORIES.filter((c) => data.totals.byCategory[c.key]);
  const total = data.totals.month;
  const all = data.costs as CostRow[];
  const started = month <= NOW;
  const due = all.filter((c) => c.appliesInMonth);
  const closed = due.filter((c) => c.actualAmount != null).length;
  /** contexto do clipe: confere a NF com o valor real (ou, sem ele, com o do plano) do mês */
  const attCtx = (c: CostRow): AttachmentContext => ({ costId: c.id, title: `Custo · ${c.name}`, amount: c.actualAmount ?? c.plannedAmount ?? c.amount, currency: c.currency, monthly: c.recurrence === 'monthly', month: c.recurrence === 'monthly' ? month : undefined });
  const kpi = (l: string, v: string, sub?: string, tone?: string) => (
    <Grid size={{ xs: 6, md: 3 }}><Card sx={{ p: 2, height: '100%' }}><Typography variant="caption">{l}</Typography><Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: 22, color: tone, fontVariantNumeric: 'tabular-nums' }}>{v}</Typography>{sub && <Typography variant="caption">{sub}</Typography>}</Card></Grid>
  );
  return (
    <>
      <PageHead title="Custos" sub={`Gastos fixos e avulsos das Empresas · valores em ${currency} pela cotação do mês`}
        right={<Button size="small" variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setEdit('new')} disabled={!data.companies.length}>Adicionar custo</Button>} />
      {!data.companies.length ? (
        <Alert severity="info" variant="outlined">Nenhuma Empresa cadastrada. Os custos são lançados por Empresa (Usuários &amp; Squads → Empresas).</Alert>
      ) : (
        <>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
            <IconButton size="small" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior"><ChevronLeftRoundedIcon /></IconButton>
            <TextField select size="small" value={month} onChange={(e) => setMonth(e.target.value)} slotProps={{ htmlInput: { 'aria-label': 'Mês' } }} sx={{ minWidth: 170 }}>
              {monthOptions(36, 12).map((m) => <MenuItem key={m} value={m}>{monthTitle(m)}{m === NOW ? ' · atual' : ''}</MenuItem>)}
            </TextField>
            <IconButton size="small" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês"><ChevronRightRoundedIcon /></IconButton>
            <Box sx={{ flex: 1 }} />
            <FormControlLabel control={<Switch size="small" checked={onlyMonth} onChange={(e) => setOnlyMonth(e.target.checked)} />} label={<Typography sx={{ fontSize: 13 }}>Só os que valem no mês</Typography>} />
          </Stack>
          <Grid container spacing={1.75} sx={{ mb: 1.75 }}>
            {kpi(`Custos de ${monthShort(month)}`, money(total, currency), month === NOW ? 'mês atual' : undefined, total ? p.neg : undefined)}
            {kpi('Recorrentes (mensal)', money(data.totals.recurring, currency), `${data.costs.filter((c) => c.appliesInMonth && c.recurrence === 'monthly').length} custos`)}
            {kpi('Avulsos no mês', money(data.totals.once, currency), `${data.costs.filter((c) => c.appliesInMonth && c.recurrence === 'once').length} custos`)}
            {started
              ? kpi('Valor real (NF) lançado', `${closed} de ${due.length}`, due.length - closed ? `${due.length - closed} ainda pelo previsto` : 'mês todo pelo valor real', due.length - closed ? p.warn : p.pos)
              : kpi('Custos cadastrados', String(data.costs.length), `${due.length} valendo em ${monthShort(month)}`)}
          </Grid>
          {cats.length > 0 && (
            <Card sx={{ p: 2, mb: 1.75 }}>
              <Typography variant="overline">Por categoria em {monthTitle(month)}</Typography>
              <Stack direction="row" sx={{ height: 12, borderRadius: 6, overflow: 'hidden', bgcolor: p.panel3, my: 1.25 }} aria-hidden>
                {cats.map((c) => <Tooltip key={c.key} title={`${c.label}: ${money(data.totals.byCategory[c.key]!, currency)}`}><Box sx={{ width: `${(data.totals.byCategory[c.key]! / total) * 100}%`, bgcolor: c.color }} /></Tooltip>)}
              </Stack>
              <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {cats.map((c) => (
                  <Stack key={c.key} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: c.color }} />
                    <Typography sx={{ fontSize: 13 }}>{c.label}</Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money(data.totals.byCategory[c.key]!, currency)}</Typography>
                    <Typography variant="caption">{Math.round((data.totals.byCategory[c.key]! / total) * 100)}%</Typography>
                  </Stack>
                ))}
              </Stack>
            </Card>
          )}
          <Card>
            <CardHeader title="Custos lançados" subheader={<>
              Plano = valor combinado (mudou de plano? use <TrendingUpRoundedIcon sx={{ fontSize: 15, verticalAlign: 'text-bottom' }} /> <b>Mudar plano</b> a partir do mês do upgrade).
              Quando a fatura chegar, use <ReceiptLongOutlinedIcon sx={{ fontSize: 15, verticalAlign: 'text-bottom' }} /> <b>Valor do mês</b> com o valor da NF e anexe o PDF no clipe: esse valor real substitui o previsto no fechamento e no caixa.
            </>} />
            <TableContainer><Table>
              <TableHead><TableRow>
                {['Custo', 'Categoria', ...(multi ? ['Empresa'] : []), 'Plano', 'Recorrência', `Em ${monthShort(month)}`, ''].map((h) => <TableCell key={h} align={h.startsWith('Em ') || h === 'Plano' ? 'right' : 'left'}>{h}</TableCell>)}
              </TableRow></TableHead>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id} sx={{ opacity: c.appliesInMonth ? 1 : 0.55 }}>
                    <TableCell sx={{ whiteSpace: 'normal', minWidth: 180 }}><b>{c.name}</b>{c.notes && <Typography variant="caption" component="div">{c.notes}</Typography>}{c.site && <Typography variant="caption" component="div" sx={{ color: p.accent }}>site: {c.site}</Typography>}</TableCell>
                    <TableCell><Chip size="small" label={CATEGORY[c.category].label} sx={{ height: 22, fontSize: 12, fontWeight: 600, color: CATEGORY[c.category].color, bgcolor: alpha(CATEGORY[c.category].color, 0.14) }} /></TableCell>
                    {multi && <TableCell sx={{ whiteSpace: 'nowrap' }}>{c.companyName}</TableCell>}
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {money(c.plannedAmount ?? c.amount, c.currency)}
                      {c.planChangedFrom != null ? (
                        <Typography variant="caption" component="div" sx={{ color: p.accent }}>{(c.plannedAmount ?? 0) > c.planChangedFrom ? '↑ upgrade' : '↓ mudou'} · era {money(c.planChangedFrom, c.currency)}</Typography>
                      ) : !!c.prices?.length && (
                        <Typography variant="caption" component="div">{c.prices.length} mudança{c.prices.length > 1 ? 's' : ''} de plano</Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {c.recurrence === 'monthly' ? `Mensal · ${monthShort(c.startMonth)} → ${c.endMonth ? monthShort(c.endMonth) : 'sem fim'}` : `Avulso · ${monthShort(c.startMonth)}`}
                      <Typography variant="caption" component="div">paga dia {c.payDay}</Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {c.appliesInMonth ? (
                        <>
                          <Box sx={{ fontWeight: 600 }}>{money(c.monthAmount ?? 0, currency)}</Box>
                          <MonthStatus c={c} started={started} past={month < NOW} />
                        </>
                      ) : <Typography variant="caption">fora do mês</Typography>}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {c.appliesInMonth && started && (
                        <Tooltip title={c.actualAmount != null ? 'Valor real do mês (editar)' : 'Lançar o valor real do mês (da fatura/NF)'}>
                          <IconButton size="small" onClick={() => setClose(c)} aria-label={`Valor real de ${c.name} em ${monthTitle(month)}`} sx={{ color: c.actualAmount != null ? p.pos : month < NOW ? p.warn : undefined }}>
                            <ReceiptLongOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {c.recurrence === 'monthly' && (
                        <Tooltip title="Mudar plano (upgrade / downgrade)"><IconButton size="small" onClick={() => setPlan(c)} aria-label={`Mudar plano de ${c.name}`}><TrendingUpRoundedIcon fontSize="small" /></IconButton></Tooltip>
                      )}
                      <AttachmentsButton count={c.attachments ?? 0} required={c.appliesInMonth && started} onClick={() => setAtt(attCtx(c))} />
                      <Tooltip title="Editar"><IconButton size="small" onClick={() => setEdit(c)} aria-label={`Editar ${c.name}`}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Excluir"><IconButton size="small" onClick={() => setDel(c)} aria-label={`Excluir ${c.name}`}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && <TableRow><TableCell colSpan={multi ? 7 : 6} align="center" sx={{ py: 4, color: 'text.disabled' }}>{data.costs.length ? `Nenhum custo vale em ${monthTitle(month)}.` : 'Nenhum custo lançado. Comece pelas ferramentas mensais, domínios e hospedagem.'}</TableCell></TableRow>}
              </TableBody>
            </Table></TableContainer>
          </Card>
        </>
      )}
      {edit && <CostDialog key={edit === 'new' ? 'new' : edit.id} initial={edit === 'new' ? null : edit} companies={data.companies} month={month} onClose={() => setEdit(null)} />}
      {att && <AttachmentsDialog ctx={att} onClose={() => setAtt(null)} />}
      {close && !att && <CloseMonthDialog key={close.id + month} cost={rows.find((r) => r.id === close.id) ?? close} month={month} onClose={() => setClose(null)} onAttach={() => setAtt(attCtx(rows.find((r) => r.id === close.id) ?? close))} />}
      {plan && <PlanDialog key={plan.id} cost={all.find((r) => r.id === plan.id) ?? plan} month={month} onClose={() => setPlan(null)} />}
      <ConfirmDialog open={!!del} title="Excluir custo?" busy={remove.isPending} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id, { onSuccess: () => setDel(null) })}>
        <b>{del?.name}</b> sai de todos os meses (inclusive os já fechados). Para parar de contar só daqui para frente, edite e coloque o mês de fim.
      </ConfirmDialog>
    </>
  );
}

const parseMoney = (s: string) => Number(s.trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));

function CostDialog({ initial, companies, month, onClose }: { initial: FinanceCost | null; companies: FinanceCompany[]; month: string; onClose: () => void }) {
  const { company } = useFilters();
  const [f, setF] = useState<FinanceCostInput>(initial ? { ...initial } : {
    companyId: company && companies.some((c) => c.id === company) ? company : companies[0]?.id ?? '', name: '', category: 'tools', amount: 0, currency: 'BRL',
    recurrence: 'monthly', startMonth: month, endMonth: null, payDay: 5, notes: '',
  });
  const [amount, setAmount] = useState(initial ? String(initial.amount).replace('.', ',') : '');
  const [site, setSite] = useState((initial as CostRow | null)?.site ?? '');
  const [err, setErr] = useState('');
  const save = useFinanceMutation(financeApi.saveCost);
  const set = <K extends keyof FinanceCostInput>(k: K, v: FinanceCostInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const months = useMemo(() => monthOptions(36, 24), []);
  const submit = () => {
    const v = parseMoney(amount);
    if (f.name.trim().length < 2) return setErr('Dê um nome ao custo (ex.: "Hospedagem VPS").');
    if (!(v > 0)) return setErr('Informe um valor maior que zero.');
    if (f.recurrence === 'monthly' && f.endMonth && f.endMonth < f.startMonth) return setErr('O mês de fim não pode ser antes do início.');
    const payload = { ...f, id: initial?.id, amount: v, endMonth: f.recurrence === 'once' ? null : f.endMonth, notes: f.notes || null, site: site.trim() || null } as FinanceCostInput;
    save.mutate(payload, {
      onSuccess: onClose, onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
    });
  };
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{initial ? 'Editar custo' : 'Adicionar custo'}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.75} sx={{ mt: 0.5 }}>
          <TextField size="small" label="Nome" value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus placeholder="ex.: Hospedagem VPS, Ferramenta de IA, Salário editor" />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
            <TextField select size="small" label="Categoria" value={f.category} onChange={(e) => set('category', e.target.value as CostCategory)} sx={{ flex: 1 }}
              slotProps={{ select: { renderValue: (v) => CATEGORY[v as CostCategory].label } }}>
              {COST_CATEGORIES.map((c) => <MenuItem key={c.key} value={c.key}><Stack><span>{c.label}</span><Typography variant="caption">{c.hint}</Typography></Stack></MenuItem>)}
            </TextField>
            {companies.length > 1 && (
              <TextField select size="small" label="Empresa" value={f.companyId} onChange={(e) => set('companyId', e.target.value)} sx={{ flex: 1 }}>
                {companies.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
              </TextField>
            )}
          </Stack>
          <Stack direction="row" spacing={1.25}>
            <TextField size="small" label={f.recurrence === 'monthly' ? 'Valor do plano' : 'Valor'} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" sx={{ flex: 1 }}
              helperText={initial && f.recurrence === 'monthly' ? 'Valor do início. Fez upgrade? Use "Mudar plano" para não alterar os meses antigos.' : undefined}
              slotProps={{ input: { startAdornment: <InputAdornment position="start">{f.currency === 'BRL' ? 'R$' : f.currency === 'USD' ? 'US$' : '€'}</InputAdornment> } }} />
            <TextField select size="small" label="Moeda" value={f.currency} onChange={(e) => set('currency', e.target.value as Currency)} sx={{ width: 100 }}>
              {(['BRL', 'USD', 'EUR'] as Currency[]).map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </TextField>
          </Stack>
          <ToggleButtonGroup exclusive size="small" fullWidth value={f.recurrence} onChange={(_, v) => v && set('recurrence', v)}>
            <ToggleButton value="monthly">Mensal (recorrente)</ToggleButton><ToggleButton value="once">Avulso (uma vez)</ToggleButton>
          </ToggleButtonGroup>
          <Stack direction="row" spacing={1.25}>
            <TextField select size="small" label={f.recurrence === 'monthly' ? 'A partir de' : 'Mês'} value={f.startMonth} onChange={(e) => set('startMonth', e.target.value)} sx={{ flex: 1 }}>
              {months.map((m) => <MenuItem key={m} value={m}>{monthTitle(m)}</MenuItem>)}
            </TextField>
            {f.recurrence === 'monthly' && (
              <TextField select size="small" label="Até" value={f.endMonth ?? ''} onChange={(e) => set('endMonth', e.target.value || null)} sx={{ flex: 1 }} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
                <MenuItem value="">Sem fim</MenuItem>
                {months.filter((m) => m >= f.startMonth).map((m) => <MenuItem key={m} value={m}>{monthTitle(m)}</MenuItem>)}
              </TextField>
            )}
            <TextField select size="small" label="Dia do pagamento" value={f.payDay} onChange={(e) => set('payDay', Number(e.target.value))} sx={{ width: 150 }}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <MenuItem key={d} value={d}>dia {d}</MenuItem>)}
            </TextField>
          </Stack>
          <TextField size="small" label="Observação (opcional)" value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="ex.: plano anual dividido por 12, cartão final 1234" />
          <TextField size="small" label="Site (opcional)" value={site} onChange={(e) => setSite(e.target.value)} placeholder="ex.: dominiox.com"
            helperText="Custo só de um site (plugin, tema, domínio dele)? Informe o site: ele entra no lucro do site e na comissão do gestor." />
          {err && <Alert severity="error" variant="outlined">{err}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={submit} disabled={save.isPending}>{save.isPending ? 'Salvando…' : initial ? 'Salvar' : 'Adicionar'}</Button>
      </DialogActions>
    </Dialog>
  );
}

const curSym = (c: Currency) => (c === 'BRL' ? 'R$' : c === 'USD' ? 'US$' : '€');
const toInput = (n: number) => n.toFixed(2).replace('.', ',');

/** Situação do mês: valor real lançado (pela NF) ou ainda pelo previsto. */
function MonthStatus({ c, started, past }: { c: CostRow; started: boolean; past: boolean }) {
  const { pluto: p } = useTheme();
  const chip = (label: string, color: string) => <Chip size="small" label={label} sx={{ height: 18, fontSize: 10.5, fontWeight: 600, color, bgcolor: alpha(color, 0.14), mt: 0.25 }} />;
  if (c.actualAmount != null) {
    const diff = c.actualAmount - (c.plannedAmount ?? c.amount);
    return (
      <Stack sx={{ alignItems: 'flex-end' }}>
        {chip('real · NF', p.pos)}
        {Math.abs(diff) >= 0.005 && <Typography variant="caption" sx={{ lineHeight: 1.3 }}>plano {money(c.plannedAmount ?? c.amount, c.currency)} · {diff > 0 ? '+' : '−'}{money(Math.abs(diff), c.currency)}</Typography>}
      </Stack>
    );
  }
  if (!started) return chip('previsto', p.fg2);
  return chip(past ? 'previsto · falta NF' : 'previsto', past ? p.warn : p.fg2);
}

/** Valor real do mês: o que veio na fatura/NF (pode ser menor/maior que o plano). */
function CloseMonthDialog({ cost, month, onClose, onAttach }: { cost: CostRow; month: string; onClose: () => void; onAttach: () => void }) {
  const { pluto: p } = useTheme();
  const planned = cost.plannedAmount ?? cost.amount;
  const listQ = { costId: cost.id, ...(cost.recurrence === 'monthly' ? { month } : {}) };
  const { data } = useQuery({ queryKey: ['finance', 'attachments', listQ], queryFn: () => attachmentsApi.list(listQ) });
  const nfs = (data?.attachments ?? []).filter((a) => a.amount != null && (!a.currency || a.currency === cost.currency));
  const [amount, setAmount] = useState(toInput(cost.actualAmount ?? planned));
  const [touched, setTouched] = useState(cost.actualAmount != null);
  const [note, setNote] = useState(cost.actualNote ?? '');
  const [err, setErr] = useState('');
  const save = useFinanceMutation(costMonthApi.close);
  const reopen = useFinanceMutation(costMonthApi.reopen);
  // sem valor real ainda: sugere o valor da NF anexada
  const shown = !touched && nfs.length === 1 ? toInput(nfs[0].amount!) : amount;
  const v = parseMoney(shown);
  const diff = Number.isFinite(v) ? v - planned : 0;
  const submit = () => {
    if (!(v >= 0) || !shown.trim()) return setErr('Informe o valor que veio na fatura/NF.');
    save.mutate({ id: cost.id, month, amount: v, note }, { onSuccess: onClose, onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.') });
  };
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>Valor real de {monthTitle(month)}</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontWeight: 600, mb: 1.5 }}>{cost.name}</Typography>
        <Stack spacing={1.5}>
          <Box sx={{ p: 1.25, borderRadius: 1.5, bgcolor: alpha(p.accent, 0.08), fontSize: 13.5 }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}><span>Previsto pelo plano</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{money(planned, cost.currency)}</b></Stack>
            {cost.planChangedFrom != null && <Typography variant="caption" component="div">O plano mudou neste mês (antes {money(cost.planChangedFrom, cost.currency)}). Se a fatura veio proporcional, lance o valor cobrado.</Typography>}
          </Box>
          {nfs.length > 0 ? (
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <Typography variant="caption">Usar valor da NF:</Typography>
              {nfs.map((a) => <Chip key={a.id} size="small" clickable onClick={() => { setAmount(toInput(a.amount!)); setTouched(true); }} label={`${a.docNumber ? `NF ${a.docNumber.replace(/^NF\s*/i, '')} · ` : ''}${money(a.amount!, cost.currency)}`} sx={{ fontWeight: 600 }} />)}
            </Stack>
          ) : (
            <Alert severity="warning" variant="outlined" action={<Button size="small" onClick={onAttach}>Anexar NF</Button>} sx={{ py: 0 }}>Nenhuma NF anexada em {monthShort(month)}.</Alert>
          )}
          <TextField size="small" label="Valor cobrado na fatura/NF" value={shown} autoFocus inputMode="decimal"
            onChange={(e) => { setAmount(e.target.value); setTouched(true); }}
            helperText={Number.isFinite(v) && Math.abs(diff) >= 0.005 ? `${diff > 0 ? '+' : '−'}${money(Math.abs(diff), cost.currency)} em relação ao plano` : 'igual ao plano'}
            slotProps={{ input: { startAdornment: <InputAdornment position="start">{curSym(cost.currency)}</InputAdornment> } }} />
          <TextField size="small" label="Observação (opcional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: 1 login removido, proporcional do upgrade" />
          <Typography variant="caption">Esse valor substitui o previsto em {monthShort(month)} no fechamento e no caixa. Os outros meses continuam pelo plano.</Typography>
          {err && <Alert severity="error" variant="outlined">{err}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        {cost.actualAmount != null && <Button color="warning" onClick={() => reopen.mutate({ id: cost.id, month }, { onSuccess: onClose })} disabled={reopen.isPending} sx={{ mr: 'auto' }}>Voltar ao previsto</Button>}
        <Button variant="outlined" onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={submit} disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar valor real'}</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Mudança de plano: novo valor a partir de um mês; os meses de antes ficam com o valor antigo. */
function PlanDialog({ cost, month, onClose }: { cost: CostRow; month: string; onClose: () => void }) {
  const { pluto: p } = useTheme();
  const prices = cost.prices ?? [];
  const options = useMemo(() => monthOptions(36, 24).filter((m) => m > cost.startMonth && (!cost.endMonth || m <= cost.endMonth)).reverse(), [cost.startMonth, cost.endMonth]);
  const [from, setFrom] = useState(options.includes(month) ? month : options.find((m) => m >= NOW) ?? options[0] ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const add = useFinanceMutation(costMonthApi.addPrice);
  const remove = useFinanceMutation(costMonthApi.removePrice);
  const current = (() => { let v = cost.amount; for (const x of prices) if (x.from <= from) v = x.amount; return v; })();
  const before = (() => { let v = cost.amount; for (const x of prices) if (x.from < from) v = x.amount; return v; })();   // valor até o mês anterior
  const submit = () => {
    const v = parseMoney(amount);
    if (!(v > 0)) return setErr('Informe o novo valor do plano.');
    add.mutate({ id: cost.id, fromMonth: from, amount: v, note }, { onSuccess: () => { setAmount(''); setNote(''); setErr(''); }, onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.') });
  };
  const line = (m: string, v: number, sub: string, prev: number | null, del?: () => void) => (
    <Stack key={m} direction="row" spacing={1.25} sx={{ alignItems: 'center', py: 0.75, borderBottom: `1px solid ${p.line}` }}>
      <Box sx={{ width: 8, height: 8, borderRadius: 4, bgcolor: prev == null ? p.fg2 : v > prev ? p.warn : p.pos, flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 14 }}>a partir de <b>{monthTitle(m)}</b></Typography>
        <Typography variant="caption" component="div">{sub}</Typography>
      </Box>
      <Box sx={{ textAlign: 'right' }}>
        <Typography sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(v, cost.currency)}</Typography>
        {prev != null && <Typography variant="caption" sx={{ color: v > prev ? p.warn : p.pos }}>{v > prev ? '+' : '−'}{money(Math.abs(v - prev), cost.currency)}</Typography>}
      </Box>
      {del ? <IconButton size="small" onClick={del} aria-label={`Desfazer mudança de ${monthTitle(m)}`}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton> : <Box sx={{ width: 30 }} />}
    </Stack>
  );
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>Mudar plano · {cost.name}</DialogTitle>
      <DialogContent>
        <Typography variant="overline">Histórico do plano</Typography>
        <Box sx={{ mb: 2 }}>
          {line(cost.startMonth, cost.amount, 'início do custo', null)}
          {prices.map((x, i) => line(x.from, x.amount, x.note || 'mudança de plano', i ? prices[i - 1].amount : cost.amount, () => remove.mutate({ id: cost.id, priceId: x.id })))}
        </Box>
        <Typography variant="overline">Nova mudança</Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
            <TextField select size="small" label="A partir de" value={from} onChange={(e) => setFrom(e.target.value)} sx={{ flex: 1 }}>
              {options.map((m) => <MenuItem key={m} value={m}>{monthTitle(m)}{m === NOW ? ' · atual' : ''}</MenuItem>)}
            </TextField>
            <TextField size="small" label="Novo valor do plano" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={toInput(current)} sx={{ flex: 1 }}
              slotProps={{ input: { startAdornment: <InputAdornment position="start">{curSym(cost.currency)}</InputAdornment> } }} />
          </Stack>
          <TextField size="small" label="Motivo (opcional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: upgrade para o plano Pro, +2 logins no Workspace" />
          <Alert severity="info" variant="outlined" sx={{ py: 0 }}>
            Até {monthShort(shiftMonth(from, -1))} continua {money(before, cost.currency)}. De {monthShort(from)} em diante passa a ser o novo valor. Meses já fechados pela NF não mudam.
          </Alert>
          {err && <Alert severity="error" variant="outlined">{err}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>Fechar</Button>
        <Button variant="contained" startIcon={<TrendingUpRoundedIcon />} onClick={submit} disabled={add.isPending || !from}>{add.isPending ? 'Salvando…' : 'Salvar mudança'}</Button>
      </DialogActions>
    </Dialog>
  );
}
