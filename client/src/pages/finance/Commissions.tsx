import {
  Alert, Autocomplete, Avatar, Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Grid, IconButton, InputAdornment, MenuItem, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography, alpha, useTheme,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useFilters } from '@/context/FiltersContext';
import { useFinanceMutation } from '@/hooks/queries';
import { ApiError } from '@/lib/api/client';
import { ErrorBox, PageHead, PageSkeleton } from '@/components/ui/States';
import { ddmmyyyy, monthTitle, shiftMonth } from '@/lib/finance';
import {
  brl, brl0, commissionsApi, parseNum, pctFmt, STATUS, tiersText,
  type Assignment, type AssignmentsResponse, type CommissionLine, type CommissionsResponse, type SiteCard, type Tier,
} from '@/lib/financeOps';
import { todayISO } from '@/lib/period';

const NOW = todayISO().slice(0, 7);
const initials = (n: string) => n.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();

/**
 * Finance → Comissões. Tudo vem do Caixa Empresa: receitas e gastos lançados com site no mês de referência,
 * menos os custos do site (aba Custos). Site negativo desconta da comissão do gestor. A comissão é paga por fora:
 * aqui o Admin aprova e marca como paga (não gera lançamento no Caixa). O gestor vê só os próprios sites.
 */
export default function CommissionsPage() {
  const { pluto: p } = useTheme();
  const { company: globalCompany } = useFilters();
  const [company, setCompany] = useState(globalCompany || '');
  const [user, setUser] = useState('');
  const [month, setMonth] = useState(shiftMonth(NOW, -1));
  const [people, setPeople] = useState(false);
  const [rule, setRule] = useState(false);
  const q = { company: company || undefined, month, user: user || undefined };
  const { data, error, refetch } = useQuery({ queryKey: ['finance', 'commissions', q], queryFn: () => commissionsApi.list(q), placeholderData: keepPreviousData });
  if (error && !data) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  const admin = data.viewer.role === 'admin', mgr = data.viewer.role === 'manager';
  const co = new Map(data.companies.map((c) => [c.id, c.name]));
  const t = data.totals;
  return (
    <>
      <PageHead title="Comissões"
        sub={mgr ? 'Seus sites no mês e a sua comissão.' : 'Resultado de cada site no mês, direto do Caixa Empresa. A comissão é paga por fora: aqui você aprova e marca como paga.'}
        right={admin && <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" startIcon={<GroupsOutlinedIcon />} onClick={() => setPeople(true)}>Gestores e sites</Button>
          <Button size="small" variant="outlined" startIcon={<TuneRoundedIcon />} onClick={() => setRule(true)}>Regra</Button>
        </Stack>} />

      {/* filtros: Empresa · Gestor · Mês de fechamento */}
      <Card sx={{ p: 1.5, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} sx={{ alignItems: { md: 'center' } }}>
          {!mgr && data.companies.length > 1 && (
            <TextField select size="small" label="Empresa" value={company} onChange={(e) => setCompany(e.target.value)} sx={{ minWidth: 180 }} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
              <MenuItem value="">Todas</MenuItem>{data.companies.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
          )}
          {!mgr && (
            <TextField select size="small" label="Gestor" value={user} onChange={(e) => setUser(e.target.value)} sx={{ minWidth: 180 }} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
              <MenuItem value="">Todos</MenuItem>{data.managers.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
            </TextField>
          )}
          <TextField select size="small" label="Mês de fechamento" value={month} onChange={(e) => setMonth(e.target.value)} sx={{ minWidth: 200 }}>
            {data.months.map((m) => <MenuItem key={m} value={m}>{monthTitle(m)}{m === NOW ? ' · em apuração' : ''}</MenuItem>)}
          </TextField>
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" sx={{ maxWidth: 420 }}>
            <b style={{ color: p.fg }}>{data.rule.name}:</b> sem lucro, sem comissão · {tiersText(data.rule.tiers, data.rule.tierCurrency)} (sobre o lucro do mês)
          </Typography>
        </Stack>
      </Card>

      {/* resumo */}
      <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
        <Kpi label="Resultado dos sites" value={brl(t.result)} tone={t.result >= 0 ? p.pos : p.neg} sub={`receitas ${brl0(t.revenue)} − custos ${brl0(t.costs)}`} />
        <Kpi label={mgr ? 'Sua comissão' : 'Comissões do mês'} value={brl(t.commissions)} tone={p.accent} />
        <Kpi label="A pagar" value={brl(t.toPay)} tone={t.toPay > 0 ? p.warn : undefined} sub="aprovadas e a aprovar" />
        <Kpi label="Pagas" value={brl(t.paid)} tone={t.paid > 0 ? p.pos : undefined} />
      </Grid>

      <SectionTitle title={mgr ? 'Sua comissão' : 'Gestores'} sub={`${monthTitle(month)}${month === NOW ? ' · mês em apuração (aprova depois que fechar)' : ''}`} />
      <Grid container spacing={1.5} sx={{ mb: 3 }}>
        {data.lines.map((l) => <Grid key={l.userId + l.companyId} size={{ xs: 12, md: 6, xl: 4 }}><ManagerCard l={l} company={co.get(l.companyId) ?? ''} showCompany={data.companies.length > 1} admin={admin} /></Grid>)}
        {!data.lines.length && <Grid size={12}><Card sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>Nenhum gestor com site neste filtro.{admin && ' Vincule em "Gestores e sites".'}</Card></Grid>}
      </Grid>

      <SectionTitle title="Sites no mês" sub="Receitas − gastos do Caixa com o site − custos do site. Negativo desconta da comissão do gestor." />
      <Grid container spacing={1.5}>
        {data.sites.map((s) => <Grid key={s.companyId + s.site} size={{ xs: 12, sm: 6, lg: 4, xl: 3 }}><SiteTile s={s} company={data.companies.length > 1 ? co.get(s.companyId) : undefined} /></Grid>)}
        {!data.sites.length && <Grid size={12}><Card sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>Nenhuma receita ou gasto com site neste mês. No Caixa Empresa, informe o site e o mês de referência ao lançar.</Card></Grid>}
      </Grid>

      {people && <PeopleDialog onClose={() => setPeople(false)} />}
      {rule && <RuleDialog rule={data.rule} onClose={() => setRule(false)} />}
    </>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <Grid size={{ xs: 6, md: 3 }}>
      <Card sx={{ p: 2, height: '100%' }}>
        <Typography variant="caption">{label}</Typography>
        <Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: { xs: 19, md: 24 }, color: tone, fontVariantNumeric: 'tabular-nums', lineHeight: 1.35 }}>{value}</Typography>
        {sub && <Typography variant="caption" sx={{ fontSize: 11.5 }}>{sub}</Typography>}
      </Card>
    </Grid>
  );
}
const SectionTitle = ({ title, sub }: { title: string; sub?: string }) => (
  <Stack direction="row" spacing={1.25} sx={{ alignItems: 'baseline', mb: 1.25, flexWrap: 'wrap' }}>
    <Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: 18 }}>{title}</Typography>
    {sub && <Typography variant="caption">{sub}</Typography>}
  </Stack>
);
function Status({ s }: { s: CommissionLine['status'] }) {
  const d = STATUS[s];
  return <Chip size="small" label={d.label} sx={{ height: 22, fontSize: 11.5, fontWeight: 600, color: d.color, bgcolor: alpha(d.color, 0.15) }} />;
}

/* ---------------- card do gestor ---------------- */
function ManagerCard({ l, company, showCompany, admin }: { l: CommissionLine; company: string; showCompany: boolean; admin: boolean }) {
  const { pluto: p } = useTheme();
  const [dlg, setDlg] = useState<'approve' | 'paid' | 'reopen' | null>(null);
  const unpaid = useFinanceMutation(commissionsApi.unpaid);
  const value = l.approved ?? l.calculated;
  const max = Math.max(1, ...l.sites.map((s) => Math.abs(s.base)));
  return (
    <Card sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
        <Avatar sx={{ width: 36, height: 36, fontSize: 13, fontWeight: 600, bgcolor: alpha(p.accent, 0.2), color: p.accent }}>{initials(l.userName)}</Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600 }} noWrap>{l.userName}</Typography>
          <Typography variant="caption" noWrap component="div">{showCompany ? `${company} · ` : ''}{l.sites.length} site{l.sites.length > 1 ? 's' : ''}</Typography>
        </Box>
        <Status s={l.status} />
      </Stack>

      <Stack direction="row" sx={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="caption">Comissão</Typography>
          <Typography sx={{ fontFamily: 'Sora', fontWeight: 700, fontSize: 28, lineHeight: 1.1, color: value > 0 ? p.fg : p.fg2, fontVariantNumeric: 'tabular-nums' }}>{brl(value)}</Typography>
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          <Typography variant="caption">Lucro dos sites</Typography>
          <Typography sx={{ fontWeight: 600, color: l.profit >= 0 ? p.pos : p.neg, fontVariantNumeric: 'tabular-nums' }}>{brl(l.profit)}</Typography>
          <Typography variant="caption">{l.profit > 0 ? `faixa ${pctFmt(l.pct)} · ${l.tierCurrency === 'USD' ? 'US$' : l.tierCurrency} ${Math.round(l.profitTier).toLocaleString('pt-BR')}` : 'sem lucro, sem comissão'}</Typography>
        </Box>
      </Stack>

      <Stack spacing={0.6}>
        {l.sites.map((s) => (
          <Box key={s.site}>
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
              <Typography sx={{ fontSize: 13 }} noWrap>{s.site}{(s.sharePct < 100 || s.coverage < 1) && <Typography component="span" variant="caption"> · {s.sharePct < 100 ? `${pctFmt(s.sharePct, 0)} do site` : `${Math.round(s.coverage * 100)}% do mês`}</Typography>}</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: s.base < 0 ? p.neg : undefined, fontVariantNumeric: 'tabular-nums' }}>{brl(s.base)}</Typography>
            </Stack>
            <Box sx={{ height: 4, borderRadius: 2, bgcolor: p.panel3, overflow: 'hidden' }}><Box sx={{ height: '100%', width: `${(Math.abs(s.base) / max) * 100}%`, bgcolor: s.base < 0 ? p.neg : p.pos }} /></Box>
          </Box>
        ))}
      </Stack>
      {l.negatives < 0 && <Typography variant="caption" sx={{ color: p.neg }}>Site negativo descontou {brl(Math.abs(l.negatives))} do lucro.</Typography>}
      {l.adjustments !== 0 && <Typography variant="caption">Ajuste {l.adjustments > 0 ? '+' : '−'}{brl(Math.abs(l.adjustments))}{l.adjustmentNote ? ` · ${l.adjustmentNote}` : ''}</Typography>}
      {!l.frozen && l.incomplete.length > 0 && l.status !== 'open' && (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}><ErrorOutlineRoundedIcon sx={{ fontSize: 16, color: p.warn }} /><Typography variant="caption" sx={{ color: p.warn }}>{l.incomplete.join(' · ')}</Typography></Stack>
      )}
      {l.liveDiff != null && <Typography variant="caption" sx={{ color: p.warn }}>O Caixa mudou depois da aprovação: hoje daria {l.liveDiff > 0 ? '+' : '−'}{brl(Math.abs(l.liveDiff))}. O aprovado não muda sozinho.</Typography>}

      <Box sx={{ flex: 1 }} />
      <Divider />
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minHeight: 32 }}>
        {l.status === 'paid' && <Typography variant="caption" sx={{ flex: 1, color: p.pos }}>Paga em {ddmmyyyy(l.paidAt!)}{l.paidNote ? ` · ${l.paidNote}` : ''}</Typography>}
        {l.status === 'approved' && <Typography variant="caption" sx={{ flex: 1 }}>Aprovada{l.approvedBy ? ` por ${l.approvedBy}` : ''}</Typography>}
        {l.status === 'open' && <Typography variant="caption" sx={{ flex: 1 }}>Mês em andamento: o valor muda conforme o Caixa.</Typography>}
        {l.status === 'to_approve' && <Typography variant="caption" sx={{ flex: 1 }}>Mês fechado, pronto para aprovar.</Typography>}
        {admin && l.status === 'to_approve' && <Button size="small" variant="contained" onClick={() => setDlg('approve')}>Aprovar</Button>}
        {admin && l.status === 'approved' && <><Button size="small" onClick={() => setDlg('reopen')}>Reabrir</Button><Button size="small" variant="contained" color="success" onClick={() => setDlg('paid')}>Marcar como paga</Button></>}
        {admin && l.status === 'paid' && <Button size="small" onClick={() => l.periodId && unpaid.mutate(l.periodId)}>Desfazer</Button>}
      </Stack>
      {dlg && <ActionDialog kind={dlg} l={l} onClose={() => setDlg(null)} />}
    </Card>
  );
}

function ActionDialog({ kind, l, onClose }: { kind: 'approve' | 'paid' | 'reopen'; l: CommissionLine; onClose: () => void }) {
  const [adj, setAdj] = useState(''); const [note, setNote] = useState(''); const [date, setDate] = useState(todayISO());
  const [err, setErr] = useState('');
  const approve = useFinanceMutation(commissionsApi.approve), paid = useFinanceMutation(commissionsApi.paid), reopen = useFinanceMutation(commissionsApi.reopen);
  const fail = (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
  const a = adj.trim() ? parseNum(adj) : 0;
  const busy = approve.isPending || paid.isPending || reopen.isPending;
  const go = () => {
    if (kind === 'approve') approve.mutate({ userId: l.userId, companyId: l.companyId, month: l.month, adjustments: a || 0, adjustmentNote: note || null }, { onSuccess: onClose, onError: fail });
    else if (kind === 'paid') paid.mutate({ id: l.periodId!, date, note: note || null }, { onSuccess: onClose, onError: fail });
    else reopen.mutate({ id: l.periodId!, reason: note }, { onSuccess: onClose, onError: fail });
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{kind === 'approve' ? `Aprovar comissão · ${l.userName}` : kind === 'paid' ? `Marcar como paga · ${l.userName}` : 'Reabrir comissão'}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          {kind === 'approve' && (<>
            <Typography sx={{ fontSize: 14 }}>{monthTitle(l.month)} · lucro {brl(l.profit)} × {pctFmt(l.pct)} = <b>{brl(l.calculated)}</b></Typography>
            <TextField size="small" label="Ajuste (opcional)" value={adj} onChange={(e) => setAdj(e.target.value)} placeholder="ex.: 200 ou -150" slotProps={{ input: { startAdornment: <InputAdornment position="start">R$</InputAdornment> } }} />
            {!!a && <TextField size="small" label="Motivo do ajuste" value={note} onChange={(e) => setNote(e.target.value)} />}
            <Typography sx={{ fontWeight: 600 }}>Total aprovado: {brl(Math.max(0, l.calculated + (a || 0)))}</Typography>
            <Typography variant="caption">Os valores do mês ficam gravados. Se o Caixa mudar depois, aparece a diferença sem alterar o aprovado.</Typography>
          </>)}
          {kind === 'paid' && (<>
            <Typography sx={{ fontSize: 14 }}>Valor: <b>{brl(l.approved)}</b> · pago por fora (não entra no Caixa Empresa).</Typography>
            <TextField size="small" type="date" label="Data do pagamento" value={date} onChange={(e) => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: todayISO() } }} />
            <TextField size="small" label="Observação (opcional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: PIX" />
          </>)}
          {kind === 'reopen' && <TextField size="small" label="Motivo" value={note} onChange={(e) => setNote(e.target.value)} autoFocus helperText="Volta a calcular pelo Caixa de hoje." />}
          {err && <Alert severity="error" variant="outlined">{err}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>Cancelar</Button>
        <Button variant="contained" color={kind === 'paid' ? 'success' : 'primary'} disabled={busy || (kind === 'reopen' && note.trim().length < 3) || (kind === 'approve' && !!a && note.trim().length < 3)} onClick={go}>
          {kind === 'approve' ? 'Aprovar' : kind === 'paid' ? 'Marcar como paga' : 'Reabrir'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ---------------- card do site ---------------- */
function SiteTile({ s, company }: { s: SiteCard; company?: string }) {
  const { pluto: p } = useTheme();
  const neg = s.result < 0;
  const tone = neg ? p.neg : p.pos;
  return (
    <Card sx={{ p: 1.75, height: '100%', borderColor: neg ? alpha(p.neg, 0.55) : undefined, bgcolor: neg ? alpha(p.neg, 0.06) : undefined }}>
      <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600 }} noWrap>{s.site}</Typography>
          <Typography variant="caption" noWrap component="div">{company ? `${company} · ` : ''}{s.managers.length ? s.managers.map((m) => m.userName + (m.sharePct < 100 ? ` (${pctFmt(m.sharePct, 0)})` : '')).join(', ') : 'sem gestor'}</Typography>
        </Box>
        {neg && <Chip size="small" label="negativo" sx={{ height: 20, fontSize: 11, fontWeight: 600, color: p.neg, bgcolor: alpha(p.neg, 0.15) }} />}
      </Stack>
      <Typography sx={{ fontFamily: 'Sora', fontWeight: 700, fontSize: 22, color: tone, my: 0.75, fontVariantNumeric: 'tabular-nums' }}>{brl(s.result)}</Typography>
      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
        <Box><Typography variant="caption" component="div">Receita</Typography><Typography sx={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{brl0(s.revenue)}</Typography></Box>
        <Box sx={{ textAlign: 'right' }}><Typography variant="caption" component="div">Custos</Typography><Typography sx={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{brl0(s.costs)}</Typography></Box>
      </Stack>
      {neg && s.managers.length > 0 && <Typography variant="caption" component="div" sx={{ mt: 1, color: p.neg }}>Desconta {brl0(Math.abs(s.result))} da comissão de {s.managers.map((m) => m.userName).join(' e ')}.</Typography>}
    </Card>
  );
}

/* ---------------- gestores × sites ---------------- */
function PeopleDialog({ onClose }: { onClose: () => void }) {
  const { pluto: p } = useTheme();
  const { data } = useQuery({ queryKey: ['finance', 'assignments'], queryFn: () => commissionsApi.assignments({}) });
  const [edit, setEdit] = useState<Assignment | 'new' | null>(null);
  const [err, setErr] = useState('');
  const remove = useFinanceMutation(commissionsApi.removeAssignment);
  const co = new Map((data?.companies ?? []).map((c) => [c.id, c.name]));
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Gestores e sites</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Quem responde por cada site e desde quando. Trocou o responsável? Coloque a data de fim e crie outro vínculo: os meses anteriores não mudam.</Typography>
        {!data ? <PageSkeleton /> : edit ? <AssignmentForm data={data} initial={edit === 'new' ? null : edit} onDone={() => setEdit(null)} /> : (<>
          <TableContainer><Table size="small" sx={{ '& td, & th': { whiteSpace: 'nowrap' } }}>
            <TableHead><TableRow><TableCell>Gestor</TableCell><TableCell>Site</TableCell>{data.companies.length > 1 && <TableCell>Empresa</TableCell>}<TableCell>Período</TableCell><TableCell align="right">Rateio</TableCell><TableCell /></TableRow></TableHead>
            <TableBody>
              {data.assignments.map((a) => (
                <TableRow key={a.id} sx={{ opacity: a.endDate && a.endDate < todayISO() ? 0.55 : 1 }}>
                  <TableCell><b>{a.userName}</b></TableCell><TableCell>{a.site}</TableCell>{data.companies.length > 1 && <TableCell>{co.get(a.companyId)}</TableCell>}
                  <TableCell>{ddmmyyyy(a.startDate)} → {a.endDate ? ddmmyyyy(a.endDate) : 'atual'}</TableCell>
                  <TableCell align="right">{pctFmt(a.sharePct, 0)}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => setEdit(a)} aria-label={`Editar ${a.userName} ${a.site}`}><EditOutlinedIcon fontSize="small" /></IconButton>
                    <IconButton size="small" onClick={() => remove.mutate(a.id, { onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível excluir.') })} aria-label="Excluir vínculo"><DeleteOutlineRoundedIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {!data.assignments.length && <TableRow><TableCell colSpan={6} sx={{ color: 'text.disabled', py: 3 }} align="center">Nenhum gestor vinculado ainda.</TableCell></TableRow>}
            </TableBody>
          </Table></TableContainer>
          {err && <Alert severity="error" variant="outlined" sx={{ mt: 1.5 }} onClose={() => setErr('')}>{err}</Alert>}
          <Button startIcon={<AddRoundedIcon />} onClick={() => setEdit('new')} sx={{ mt: 1.5, color: p.accent }}>Vincular gestor a um site</Button>
        </>)}
      </DialogContent>
      <DialogActions><Button variant="outlined" onClick={onClose}>Fechar</Button></DialogActions>
    </Dialog>
  );
}
function AssignmentForm({ data, initial, onDone }: { data: AssignmentsResponse; initial: Assignment | null; onDone: () => void }) {
  const [f, setF] = useState({
    userId: initial?.userId ?? data.managers.find((m) => m.role === 'gestor')?.id ?? data.managers[0]?.id ?? '', companyId: initial?.companyId ?? data.companies[0]?.id ?? '',
    site: initial?.site ?? '', startDate: initial?.startDate ?? `${NOW}-01`, endDate: initial?.endDate ?? '', sharePct: String(initial?.sharePct ?? 100), note: initial?.note ?? '',
  });
  const [err, setErr] = useState('');
  const save = useFinanceMutation(commissionsApi.saveAssignment);
  const submit = () => save.mutate({ id: initial?.id, userId: f.userId, companyId: f.companyId, site: f.site.trim(), startDate: f.startDate, endDate: f.endDate || null, sharePct: parseNum(f.sharePct), note: f.note.trim() || null },
    { onSuccess: onDone, onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.') });
  return (
    <Stack spacing={1.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
        <TextField select size="small" label="Gestor" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })} sx={{ flex: 1 }}>{data.managers.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}</TextField>
        {data.companies.length > 1 && <TextField select size="small" label="Empresa" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })} sx={{ flex: 1 }}>{data.companies.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</TextField>}
        <Autocomplete freeSolo size="small" sx={{ flex: 1.3 }} options={data.sites.filter((s) => s.companyId === f.companyId).map((s) => s.site)} value={f.site} onInputChange={(_, v) => setF({ ...f, site: v })} renderInput={(pr) => <TextField {...pr} label="Site" placeholder="dominiox.com" />} />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
        <TextField size="small" type="date" label="Responsável desde" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} sx={{ flex: 1 }} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField size="small" type="date" label="Até (opcional)" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} sx={{ flex: 1 }} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField size="small" label="Rateio" value={f.sharePct} onChange={(e) => setF({ ...f, sharePct: e.target.value })} sx={{ width: { sm: 120 } }} helperText="100% = só ele" slotProps={{ input: { endAdornment: <InputAdornment position="end">%</InputAdornment> } }} />
      </Stack>
      <TextField size="small" label="Observação" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      {err && <Alert severity="error" variant="outlined">{err}</Alert>}
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}><Button onClick={onDone}>Voltar</Button><Button variant="contained" onClick={submit} disabled={save.isPending}>Salvar vínculo</Button></Stack>
    </Stack>
  );
}

/* ---------------- regra ---------------- */
function RuleDialog({ rule, onClose }: { rule: CommissionsResponse['rule']; onClose: () => void }) {
  const [name, setName] = useState(rule.name);
  const [tiers, setTiers] = useState<Tier[]>(rule.tiers);
  const [cur, setCur] = useState(rule.tierCurrency);
  const [err, setErr] = useState('');
  const save = useFinanceMutation(commissionsApi.saveRule);
  const set = (i: number, k: keyof Tier, v: string) => setTiers(tiers.map((t, j) => (j === i ? { ...t, [k]: parseNum(v) || 0 } : t)));
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Regra de comissão</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <TextField size="small" label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <Typography variant="body2" color="text.secondary">Sem lucro, sem comissão. A faixa que o lucro do mês atingir vale para o lucro todo.</Typography>
          {tiers.map((t, i) => (
            <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <TextField size="small" label={i === 0 ? 'Até a próxima faixa' : 'A partir de'} value={String(t.from)} disabled={i === 0} onChange={(e) => set(i, 'from', e.target.value)} sx={{ flex: 1 }}
                slotProps={{ input: { startAdornment: <InputAdornment position="start">{cur === 'USD' ? 'US$' : cur === 'EUR' ? '€' : 'R$'}</InputAdornment> } }} />
              <TextField size="small" label="%" value={String(t.pct)} onChange={(e) => set(i, 'pct', e.target.value)} sx={{ width: 96 }} />
              <IconButton size="small" disabled={i === 0} onClick={() => setTiers(tiers.filter((_, j) => j !== i))} aria-label="Remover faixa"><DeleteOutlineRoundedIcon fontSize="small" /></IconButton>
            </Stack>
          ))}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button size="small" onClick={() => setTiers([...tiers, { from: (tiers[tiers.length - 1]?.from ?? 0) + 20000, pct: (tiers[tiers.length - 1]?.pct ?? 10) + 2 }])}>+ faixa</Button>
            <Box sx={{ flex: 1 }} />
            <TextField select size="small" label="Moeda das faixas" value={cur} onChange={(e) => setCur(e.target.value as typeof cur)} sx={{ width: 150 }}>{['USD', 'BRL', 'EUR'].map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}</TextField>
          </Stack>
          <Typography variant="caption">Comissões já aprovadas mantêm a regra da época.</Typography>
          {err && <Alert severity="error" variant="outlined">{err}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions><Button variant="outlined" onClick={onClose}>Cancelar</Button>
        <Button variant="contained" disabled={save.isPending} onClick={() => save.mutate({ name, tiers, tierCurrency: cur }, { onSuccess: onClose, onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.') })}>Salvar</Button>
      </DialogActions>
    </Dialog>
  );
}
