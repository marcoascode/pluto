import { Alert, Box, Button, Card, CardHeader, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, IconButton, InputAdornment, MenuItem, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { useMemo, useState } from 'react';
import { useFilters } from '@/context/FiltersContext';
import { useFinanceCosts, useFinanceMutation } from '@/hooks/queries';
import { financeApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { ConfirmDialog, ErrorBox, PageHead, PageSkeleton } from '@/components/ui/States';
import { money } from '@/lib/format';
import { CATEGORY, COST_CATEGORIES, monthOptions, monthShort, monthTitle, shiftMonth } from '@/lib/finance';
import { todayISO } from '@/lib/period';
import type { CostCategory, Currency, FinanceCompany, FinanceCost, FinanceCostInput } from '@/types/api';

const NOW = todayISO().slice(0, 7);

/** Finance → Custos: custos fixos e avulsos lançados à mão (ferramentas, domínios, hospedagem, equipe…). Entram no fechamento e no caixa. */
export default function CostsPage() {
  const { pluto: p } = useTheme();
  const { currency } = useFilters();
  const [month, setMonth] = useState(NOW);
  const [onlyMonth, setOnlyMonth] = useState(true);
  const [edit, setEdit] = useState<FinanceCost | 'new' | null>(null);
  const [del, setDel] = useState<FinanceCost | null>(null);
  const { data, error, refetch } = useFinanceCosts(month);
  const remove = useFinanceMutation(financeApi.deleteCost);
  const rows = useMemo(() => (data?.costs ?? []).filter((c) => !onlyMonth || c.appliesInMonth).sort((a, b) => (b.monthAmount ?? 0) - (a.monthAmount ?? 0) || a.name.localeCompare(b.name)), [data, onlyMonth]);
  if (error && !data) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  const multi = data.companies.length > 1;
  const cats = COST_CATEGORIES.filter((c) => data.totals.byCategory[c.key]);
  const total = data.totals.month;
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
            {kpi('Custos cadastrados', String(data.costs.length), `${data.costs.filter((c) => c.appliesInMonth).length} valendo em ${monthShort(month)}`)}
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
            <CardHeader title="Custos lançados" subheader="Mensal: vale todo mês do início até o fim (sem fim = continua). Avulso: só no mês escolhido. O caixa desconta no dia do pagamento." />
            <TableContainer><Table>
              <TableHead><TableRow>
                {['Custo', 'Categoria', ...(multi ? ['Empresa'] : []), 'Valor', 'Recorrência', 'Pagamento', `Em ${monthShort(month)}`, ''].map((h) => <TableCell key={h} align={h.startsWith('Em ') || h === 'Valor' ? 'right' : 'left'}>{h}</TableCell>)}
              </TableRow></TableHead>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id} sx={{ opacity: c.appliesInMonth ? 1 : 0.55 }}>
                    <TableCell sx={{ whiteSpace: 'normal', minWidth: 180 }}><b>{c.name}</b>{c.notes && <Typography variant="caption" component="div">{c.notes}</Typography>}</TableCell>
                    <TableCell><Chip size="small" label={CATEGORY[c.category].label} sx={{ height: 22, fontSize: 12, fontWeight: 600, color: CATEGORY[c.category].color, bgcolor: alpha(CATEGORY[c.category].color, 0.14) }} /></TableCell>
                    {multi && <TableCell>{c.companyName}</TableCell>}
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{money(c.amount, c.currency)}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{c.recurrence === 'monthly' ? `Mensal · ${monthShort(c.startMonth)} → ${c.endMonth ? monthShort(c.endMonth) : 'sem fim'}` : `Avulso · ${monthShort(c.startMonth)}`}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>dia {c.payDay}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, whiteSpace: 'nowrap' }}>{c.appliesInMonth ? money(c.monthAmount ?? 0, currency) : <Typography variant="caption">fora do mês</Typography>}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Tooltip title="Editar"><IconButton size="small" onClick={() => setEdit(c)} aria-label={`Editar ${c.name}`}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Excluir"><IconButton size="small" onClick={() => setDel(c)} aria-label={`Excluir ${c.name}`}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && <TableRow><TableCell colSpan={multi ? 8 : 7} align="center" sx={{ py: 4, color: 'text.disabled' }}>{data.costs.length ? `Nenhum custo vale em ${monthTitle(month)}.` : 'Nenhum custo lançado. Comece pelas ferramentas mensais, domínios e hospedagem.'}</TableCell></TableRow>}
              </TableBody>
            </Table></TableContainer>
          </Card>
        </>
      )}
      {edit && <CostDialog key={edit === 'new' ? 'new' : edit.id} initial={edit === 'new' ? null : edit} companies={data.companies} month={month} onClose={() => setEdit(null)} />}
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
  const [err, setErr] = useState('');
  const save = useFinanceMutation(financeApi.saveCost);
  const set = <K extends keyof FinanceCostInput>(k: K, v: FinanceCostInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const months = useMemo(() => monthOptions(36, 24), []);
  const submit = () => {
    const v = parseMoney(amount);
    if (f.name.trim().length < 2) return setErr('Dê um nome ao custo (ex.: "Hospedagem VPS").');
    if (!(v > 0)) return setErr('Informe um valor maior que zero.');
    if (f.recurrence === 'monthly' && f.endMonth && f.endMonth < f.startMonth) return setErr('O mês de fim não pode ser antes do início.');
    save.mutate({ ...f, id: initial?.id, amount: v, endMonth: f.recurrence === 'once' ? null : f.endMonth, notes: f.notes || null }, {
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
            <TextField size="small" label="Valor" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" sx={{ flex: 1 }}
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
