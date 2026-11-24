import {
  Alert, Avatar, Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Grid, IconButton, InputAdornment, MenuItem, Stack,
  TextField, Typography, alpha, useTheme,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useFilters } from '@/context/FiltersContext';
import { useFinanceMutation } from '@/hooks/queries';
import { ApiError } from '@/lib/api/client';
import { ErrorBox, PageHead, PageSkeleton } from '@/components/ui/States';
import { ddmmyyyy, monthTitle, shiftMonth } from '@/lib/finance';
import {
  brl, brl0, commissionsApi, parseNum, pctFmt, STATUS, tiersText, usd,
  type CommissionLine, type CommissionsResponse, type SiteCard, type Tier,
} from '@/lib/financeOps';
import { todayISO } from '@/lib/period';

const NOW = todayISO().slice(0, 7);
const initials = (n: string) => n.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();

/**
 * Finance → Comissões (0.18.8).
 * ROI do gestor = receita líquida dos sites que ele gere (a mesma da Home, em R$ pela cotação do ROI) − despesas Google +
 * Meta + IVA SÓ das contas vinculadas a ele em Usuários & Squads. Site negativo desconta.
 * Comissão = % × ROI total do mês: progressiva (faixas do card "Comissão progressiva", editáveis pelo Admin) ou fixa (% do
 * cadastro do gestor). Mês encerrado: o Admin confere, aprova e marca como paga (pagamento feito por fora; só registra).
 */
export default function CommissionsPage() {
  const { pluto: p } = useTheme();
  const { company: globalCompany } = useFilters();
  const [company, setCompany] = useState(globalCompany || '');
  const [user, setUser] = useState('');
  const [month, setMonth] = useState(shiftMonth(NOW, -1));
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
        sub={mgr ? 'Seus sites no mês, o seu ROI e a sua comissão.' : 'ROI de cada gestor nos sites que ele gere (receita − despesas das contas vinculadas a ele em Usuários & Squads) × % da modalidade dele. A comissão é paga por fora: aqui você confere, aprova e marca como paga.'} />

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
        </Stack>
      </Card>

      {/* resumo */}
      <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
        <Kpi label={mgr ? 'Seu ROI no mês' : 'ROI dos gestores'} value={brl(t.result)} tone={t.result >= 0 ? p.pos : p.neg} sub={`≈ ${usd(t.resultUsd)} · receitas ${brl0(t.revenue)} − despesas ${brl0(t.ads)}`} />
        <Kpi label={mgr ? 'Sua comissão' : 'Comissões do mês'} value={brl(t.commissions)} tone={p.accent} />
        <Kpi label="A pagar" value={brl(t.toPay)} tone={t.toPay > 0 ? p.warn : undefined} sub="aprovadas e a aprovar" />
        <Kpi label="Pagas" value={brl(t.paid)} tone={t.paid > 0 ? p.pos : undefined} />
      </Grid>

      <RuleCard rule={data.rule} admin={admin} />

      <SectionTitle title={mgr ? 'Sua comissão' : 'Gestores'} sub={`${monthTitle(month)}${month === NOW ? ' · mês em apuração (aprova depois que fechar)' : ''}`} />
      <Grid container spacing={1.5} sx={{ mb: 3 }}>
        {data.lines.map((l) => <Grid key={l.userId + l.companyId} size={{ xs: 12, md: 6, xl: 4 }}><ManagerCard l={l} company={co.get(l.companyId) ?? ''} showCompany={data.companies.length > 1} admin={admin} /></Grid>)}
        {!data.lines.length && <Grid size={12}><Card sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>Nenhum gestor com site neste filtro.{admin && ' Os sites e as contas de cada gestor são vinculados em Configurações → Usuários & Squads (o domínio precisa estar num Squad da Empresa); datas e rateio por período em "Gestores e sites", na edição do gestor.'}</Card></Grid>}
      </Grid>

      <SectionTitle title="Sites no mês" sub="Receita líquida do dash (R$, cotação do ROI) − despesas Google + Meta + IVA das contas vinculadas ao gestor. Negativo desconta da comissão do gestor." />
      <Grid container spacing={1.5}>
        {data.sites.map((s) => <Grid key={s.companyId + s.site} size={{ xs: 12, sm: 6, lg: 4, xl: 3 }}><SiteTile s={s} company={data.companies.length > 1 ? co.get(s.companyId) : undefined} /></Grid>)}
        {!data.sites.length && <Grid size={12}><Card sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>Nenhum site com receita ou custo neste mês. Os sites vêm dos domínios do Squad de cada Empresa.</Card></Grid>}
      </Grid>

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
  const max = Math.max(1, ...l.sites.map((s) => Math.abs(s.result)));
  const modeLabel = l.mode === 'fixed' ? `Fixa · ${pctFmt(l.fixedPct ?? l.pct)}` : 'Progressiva';
  return (
    <Card sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
        <Avatar sx={{ width: 36, height: 36, fontSize: 13, fontWeight: 600, bgcolor: alpha(p.accent, 0.2), color: p.accent }}>{initials(l.userName)}</Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600 }} noWrap>{l.userName}</Typography>
          <Typography variant="caption" noWrap component="div">{showCompany ? `${company} · ` : ''}{l.sites.length} site{l.sites.length > 1 ? 's' : ''} · comissão {modeLabel.toLowerCase()}</Typography>
        </Box>
        <Status s={l.status} />
      </Stack>

      <Stack direction="row" sx={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="caption">Comissão</Typography>
          <Typography sx={{ fontFamily: 'Sora', fontWeight: 700, fontSize: 28, lineHeight: 1.1, color: value > 0 ? p.fg : p.fg2, fontVariantNumeric: 'tabular-nums' }}>{brl(value)}</Typography>
          {l.calculatedUsd > 0 && <Typography variant="caption">≈ {usd(l.calculatedUsd)}</Typography>}
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          <Typography variant="caption">ROI total</Typography>
          <Typography sx={{ fontWeight: 600, color: l.profit >= 0 ? p.pos : p.neg, fontVariantNumeric: 'tabular-nums' }}>{brl(l.profit)}</Typography>
          <Typography variant="caption" component="div">≈ {usd(l.profitUsd)}</Typography>
          <Typography variant="caption">{l.profit > 0 ? (l.mode === 'fixed' ? `fixa ${pctFmt(l.pct)}` : `progressiva · faixa ${pctFmt(l.pct)}`) : 'sem ROI positivo, sem comissão'}</Typography>
        </Box>
      </Stack>

      <Stack spacing={0.6}>
        {l.sites.map((s) => (
          <Box key={s.site}>
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
              <Typography sx={{ fontSize: 13 }} noWrap>{s.site}{(s.sharePct < 100 || (s.source && s.source !== 'rateio')) && <Typography component="span" variant="caption"> · {srcLabel(s.sharePct, s.source, s.days)}</Typography>}</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: s.result < 0 ? p.neg : undefined, fontVariantNumeric: 'tabular-nums' }}>{brl(s.result)}</Typography>
            </Stack>
            <Typography variant="caption" component="div" sx={{ fontSize: 11 }}>receita {brl0(s.revenue)} − despesas {brl0(s.ads)}</Typography>
            <Box sx={{ height: 4, borderRadius: 2, bgcolor: p.panel3, overflow: 'hidden' }}><Box sx={{ height: '100%', width: `${(Math.abs(s.result) / max) * 100}%`, bgcolor: s.result < 0 ? p.neg : p.pos }} /></Box>
          </Box>
        ))}
      </Stack>
      {l.negatives < 0 && <Typography variant="caption" sx={{ color: p.neg }}>Site negativo descontou {brl(Math.abs(l.negatives))} do ROI.</Typography>}
      {l.adjustments !== 0 && <Typography variant="caption">Ajuste {l.adjustments > 0 ? '+' : '−'}{brl(Math.abs(l.adjustments))}{l.adjustmentNote ? ` · ${l.adjustmentNote}` : ''}</Typography>}
      {!l.frozen && l.incomplete.length > 0 && l.status !== 'open' && (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}><ErrorOutlineRoundedIcon sx={{ fontSize: 16, color: p.warn }} /><Typography variant="caption" sx={{ color: p.warn }}>{l.incomplete.join(' · ')}</Typography></Stack>
      )}
      {l.liveDiff != null && <Typography variant="caption" sx={{ color: p.warn }}>Os números mudaram depois da aprovação: hoje daria {l.liveDiff > 0 ? '+' : '−'}{brl(Math.abs(l.liveDiff))}. O aprovado não muda sozinho.</Typography>}

      <Box sx={{ flex: 1 }} />
      <Divider />
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minHeight: 32 }}>
        {l.status === 'paid' && <Typography variant="caption" sx={{ flex: 1, color: p.pos }}>Paga em {ddmmyyyy(l.paidAt!)}{l.paidNote ? ` · ${l.paidNote}` : ''}</Typography>}
        {l.status === 'approved' && <Typography variant="caption" sx={{ flex: 1 }}>Aprovada{l.approvedBy ? ` por ${l.approvedBy}` : ''}</Typography>}
        {l.status === 'open' && <Typography variant="caption" sx={{ flex: 1 }}>Mês em andamento: o valor muda até o mês fechar.</Typography>}
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
            <Typography sx={{ fontSize: 14 }}>{monthTitle(l.month)} · ROI total {brl(l.profit)} (≈ {usd(l.profitUsd)}) × {pctFmt(l.pct)} ({l.mode === 'fixed' ? 'fixa' : 'progressiva'}) = <b>{brl(l.calculated)}</b> (≈ {usd(l.calculatedUsd)})</Typography>
            <TextField size="small" label="Ajuste (opcional)" value={adj} onChange={(e) => setAdj(e.target.value)} placeholder="ex.: 200 ou -150" slotProps={{ input: { startAdornment: <InputAdornment position="start">R$</InputAdornment> } }} />
            {!!a && <TextField size="small" label="Motivo do ajuste" value={note} onChange={(e) => setNote(e.target.value)} />}
            <Typography sx={{ fontWeight: 600 }}>Total aprovado: {brl(Math.max(0, l.calculated + (a || 0)))}</Typography>
            <Typography variant="caption">Os valores do mês ficam gravados. Se os números mudarem depois (sync, vínculos), aparece a diferença sem alterar o aprovado.</Typography>
          </>)}
          {kind === 'paid' && (<>
            <Typography sx={{ fontSize: 14 }}>Valor: <b>{brl(l.approved)}</b> · pago por fora (não entra no Caixa Empresa).</Typography>
            <TextField size="small" type="date" label="Data do pagamento" value={date} onChange={(e) => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: todayISO() } }} />
            <TextField size="small" label="Observação (opcional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: PIX" />
          </>)}
          {kind === 'reopen' && <TextField size="small" label="Motivo" value={note} onChange={(e) => setNote(e.target.value)} autoFocus helperText="Volta a calcular com os números e vínculos de hoje." />}
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

/** "40% · rateio", "100% · período (12 dias)", "rateio + período" */
function srcLabel(pct: number, source?: string, days?: number) {
  const p = pctFmt(pct, 3);
  if (source === 'periodo') return `${p} · período${days ? ` (${days} dia${days > 1 ? 's' : ''})` : ''}`;
  if (source === 'misto') return `${p} · rateio + período`;
  return `${p} da receita · rateio`;
}

/* ---------------- card do site ---------------- */
function SiteTile({ s, company }: { s: SiteCard; company?: string }) {
  const { pluto: p } = useTheme();
  const neg = s.result < 0;
  const tone = neg ? p.neg : p.pos;
  const unlinked = s.managers.length > 0 && s.allAds - s.ads >= 0.01;
  return (
    <Card sx={{ p: 1.75, height: '100%', borderColor: neg ? alpha(p.neg, 0.55) : undefined, bgcolor: neg ? alpha(p.neg, 0.06) : undefined }}>
      <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600 }} noWrap>{s.site}</Typography>
          <Typography variant="caption" noWrap component="div">{company ? `${company} · ` : ''}{s.managers.length ? s.managers.map((m) => m.userName + (m.sharePct < 100 || m.source !== 'rateio' ? ` (${srcLabel(m.sharePct, m.source, m.days)})` : '')).join(', ') : 'sem gestor'}</Typography>
        </Box>
        {neg && <Chip size="small" label="negativo" sx={{ height: 20, fontSize: 11, fontWeight: 600, color: p.neg, bgcolor: alpha(p.neg, 0.15) }} />}
      </Stack>
      <Typography sx={{ fontFamily: 'Sora', fontWeight: 700, fontSize: 22, color: tone, my: 0.75, fontVariantNumeric: 'tabular-nums' }}>{brl(s.result)}</Typography>
      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
        <Box><Typography variant="caption" component="div">Receita</Typography><Typography sx={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{brl0(s.revenue)}</Typography></Box>
        <Box sx={{ textAlign: 'right' }}><Typography variant="caption" component="div">{s.managers.length ? 'Despesas (contas do gestor)' : 'Despesas'}</Typography><Typography sx={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{brl0(s.ads)}</Typography></Box>
      </Stack>
      {s.roi != null && <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>ROI % {pctFmt(s.roi)}</Typography>}
      {unlinked && <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>{brl0(s.allAds - s.ads)} de despesa de contas sem vínculo com o gestor ficam fora.</Typography>}
      {!s.managers.length && <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>Sem gestor: vincule em Usuários &amp; Squads.</Typography>}
      {s.equalSplit && <Typography variant="caption" component="div" sx={{ mt: 0.5, color: p.warn }}>Rateio não definido: receita dividida igualmente (Admin → Domínios → Rateio).</Typography>}
      {neg && s.managers.length > 0 && <Typography variant="caption" component="div" sx={{ mt: 1, color: p.neg }}>Desconta {brl0(Math.abs(s.result))} do ROI de {s.managers.map((m) => m.userName).join(' e ')}.</Typography>}
    </Card>
  );
}

/* ---------------- comissão progressiva (faixas) ---------------- */
const curSym = (c: string) => (c === 'USD' ? 'US$' : c === 'EUR' ? '€' : 'R$');
function RuleCard({ rule, admin }: { rule: CommissionsResponse['rule']; admin: boolean }) {
  const { pluto: p } = useTheme();
  const [edit, setEdit] = useState(false);
  const [tiers, setTiers] = useState<{ from: string; pct: string }[]>([]);
  const [cur, setCur] = useState(rule.tierCurrency);
  const [err, setErr] = useState('');
  const save = useFinanceMutation(commissionsApi.saveRule);
  const reset = () => { setTiers([...rule.tiers].sort((a, b) => a.from - b.from).map((t) => ({ from: String(t.from).replace('.', ','), pct: String(t.pct).replace('.', ',') }))); setCur(rule.tierCurrency); setErr(''); };
  const set = (i: number, k: 'from' | 'pct', v: string) => setTiers(tiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  const submit = () => {
    const list: Tier[] = tiers.map((t) => ({ from: parseNum(t.from), pct: parseNum(t.pct) }));
    if (list.some((t) => !Number.isFinite(t.from) || t.from < 0 || !Number.isFinite(t.pct) || t.pct < 0 || t.pct > 100)) return setErr('Confira os valores: patamar a partir de 0 e % entre 0 e 100.');
    if (new Set(list.map((t) => t.from)).size !== list.length) return setErr('Dois patamares não podem começar no mesmo valor.');
    setErr('');
    save.mutate({ name: rule.name || 'Progressiva', tiers: list.map((t, i) => (i === 0 ? { ...t, from: 0 } : t)), tierCurrency: cur },
      { onSuccess: () => setEdit(false), onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.') });
  };
  const sorted = [...rule.tiers].sort((a, b) => a.from - b.from);
  return (
    <Card sx={{ p: 2, mb: 2.5 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 1.25 }}>
        <Box>
          <Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: 16 }}>Comissão progressiva</Typography>
          <Typography variant="caption">Vale para os gestores com modalidade Progressiva. A faixa atingida pelo ROI total do mês vale para o ROI todo; sem ROI positivo, sem comissão. Gestores com comissão Fixa usam a % do cadastro (Usuários &amp; Squads).</Typography>
        </Box>
        {admin && !edit && <Button size="small" variant="outlined" onClick={() => { reset(); setEdit(true); }}>Editar faixas</Button>}
      </Stack>
      {!edit ? (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
          {sorted.map((t, i) => {
            const next = sorted[i + 1];
            const k = (v: number) => `${curSym(rule.tierCurrency)} ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const range = !next ? (i === 0 ? 'Qualquer ROI' : `A partir de ${k(t.from)}`) : i === 0 ? `Até ${k(next.from - 0.01)}` : `${k(t.from)} a ${k(next.from - 0.01)}`;
            return (
              <Box key={i} sx={{ flex: 1, p: 1.5, borderRadius: 2, bgcolor: alpha(p.accent, 0.06 + i * 0.04), border: `1px solid ${alpha(p.accent, 0.25)}` }}>
                <Typography variant="caption" component="div">ROI no mês · {range}</Typography>
                <Typography sx={{ fontFamily: 'Sora', fontWeight: 700, fontSize: 22, color: p.accent }}>{pctFmt(t.pct)}</Typography>
              </Box>
            );
          })}
        </Stack>
      ) : (
        <Stack spacing={1.25} sx={{ maxWidth: 560 }}>
          {tiers.map((t, i) => (
            <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <TextField size="small" label={i === 0 ? 'Patamar inicial' : 'ROI a partir de'} value={i === 0 ? '0' : t.from} disabled={i === 0} onChange={(e) => set(i, 'from', e.target.value)} sx={{ flex: 1 }}
                slotProps={{ input: { startAdornment: <InputAdornment position="start">{curSym(cur)}</InputAdornment> } }} />
              <TextField size="small" label="Comissão" value={t.pct} onChange={(e) => set(i, 'pct', e.target.value)} sx={{ width: 120 }}
                slotProps={{ htmlInput: { inputMode: 'decimal' }, input: { endAdornment: <InputAdornment position="end">%</InputAdornment> } }} />
              <IconButton size="small" disabled={i === 0} onClick={() => setTiers(tiers.filter((_, j) => j !== i))} aria-label="Remover faixa"><DeleteOutlineRoundedIcon fontSize="small" /></IconButton>
            </Stack>
          ))}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button size="small" startIcon={<AddRoundedIcon />} disabled={tiers.length >= 10}
              onClick={() => { const last = tiers[tiers.length - 1]; setTiers([...tiers, { from: String((parseNum(last?.from ?? '0') || 0) + 20000), pct: String((parseNum(last?.pct ?? '10') || 10) + 2) }]); }}>Faixa</Button>
            <Box sx={{ flex: 1 }} />
            <TextField select size="small" label="Moeda dos patamares" value={cur} onChange={(e) => setCur(e.target.value as typeof cur)} sx={{ width: 170 }}>{['USD', 'BRL', 'EUR'].map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}</TextField>
          </Stack>
          <Typography variant="caption">Prévia: {tiersText(tiers.map((t, i) => ({ from: i === 0 ? 0 : parseNum(t.from) || 0, pct: parseNum(t.pct) || 0 })), cur)}. Comissões já aprovadas mantêm a % da época.</Typography>
          {err && <Alert severity="error" variant="outlined">{err}</Alert>}
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => { reset(); setEdit(false); }}>Cancelar</Button>
            <Button variant="contained" disabled={save.isPending} onClick={submit}>{save.isPending ? 'Salvando…' : 'Salvar faixas'}</Button>
          </Stack>
        </Stack>
      )}
    </Card>
  );
}
