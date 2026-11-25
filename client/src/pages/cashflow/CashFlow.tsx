import { Alert, Box, Button, ButtonBase, Card, CardContent, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, IconButton, MenuItem, Snackbar, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CreditCardOutlinedIcon from '@mui/icons-material/CreditCardOutlined';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { useAdminMutation, useCashflowCards, useCashflowEntries, useCashflowMonths } from '@/hooks/queries';
import { cashflowApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';
import { ddmm, money } from '@/lib/format';
import { parseNum } from '@/lib/financeOps';
import { ConfirmDialog, ErrorBox, PageHead, PageSkeleton, Stat, Tag } from '@/components/ui/States';
import { OriginsSection } from './Origins';
import type { CashflowCard, CashflowEntry, CashflowEntryInput, CashflowKind } from '@/types/api';

/**
 * 0.18.15 · Fluxo de caixa por faturas de cartão (por usuário). Só com a flag can_use_cashflow (SuperAdmin atribui).
 * Etapa 2: cartões e lançamentos manuais, organizados pelo mês da DATA DA COMPRA. Etapa 3 (0.18.16): faturas em PDF → ./Statements.tsx.
 * Etapa 4 (0.18.17): aba "Por origem" — soma do mês por origem, juntando faturas e cartões → ./Origins.tsx.
 */
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MES3 = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthLabel = (ym: string) => `${MESES[+ym.slice(5, 7) - 1]} de ${ym.slice(0, 4)}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const shiftMonth = (ym: string, d: number) => { const t = +ym.slice(0, 4) * 12 + (+ym.slice(5, 7) - 1) + d; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const brl = (v: number) => money(v, 'BRL');

export const KIND_LABEL: Record<CashflowKind, string> = { purchase: 'Compra', refund: 'Estorno / crédito', fee: 'Tarifa / anuidade', iof: 'IOF', interest: 'Juros / encargos', payment: 'Pagamento da fatura' };
export const cardLabel = (c: CashflowCard) => [c.issuer, c.nickname, c.last4 && `•••• ${c.last4}`].filter(Boolean).join(' · ');
const INV = [qk.cashflow];

export default function CashFlow() {
  const [month, setMonth] = useState(thisMonth);
  // 0.18.17: aba "Por origem" (soma do mês por origem) — fica na URL (?ver=origem)
  const [params, setParams] = useSearchParams();
  const view = params.get('ver') === 'origem' ? 'origem' : 'lancamentos';
  const setView = (v: string) => setParams((p) => { const n = new URLSearchParams(p); if (v === 'origem') n.set('ver', 'origem'); else n.delete('ver'); return n; }, { replace: true });
  const [card, setCard] = useState('');
  const [edit, setEdit] = useState<CashflowEntry | 'new' | null>(null);
  const [del, setDel] = useState<CashflowEntry | null>(null);
  const [cardsOpen, setCardsOpen] = useState(false);
  const [toast, setToast] = useState('');
  const cards = useCashflowCards();
  const { data, error, refetch } = useCashflowEntries(month, card);
  const months = useCashflowMonths(thisMonth());
  const remove = useAdminMutation(cashflowApi.deleteEntry, INV);
  const toggle = useAdminMutation(cashflowApi.updateEntry, INV);
  const monthList = months.data?.months ?? [];
  const maxNet = Math.max(1, ...monthList.map((x) => x.net));
  const cardById = new Map((cards.data?.cards ?? []).map((c) => [c.id, c]));

  const setExcluded = (e: CashflowEntry, excluded: boolean) => toggle.mutate(
    { id: e.id, ...toInput(e), excluded },
    { onError: (err) => setToast(err instanceof ApiError ? err.message : 'Não foi possível alterar o lançamento.') },
  );

  return (
    <>
      <PageHead title="Fluxo de caixa" sub="Lançamentos das faturas de cartão, organizados pelo mês da data da compra. Os dados são só seus."
        right={<>
          <Button variant="outlined" startIcon={<CreditCardOutlinedIcon />} onClick={() => setCardsOpen(true)}>Cartões</Button>
          <Button variant="outlined" startIcon={<UploadFileRoundedIcon />} component={RouterLink} to="/faturas">Enviar fatura (PDF)</Button>
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setEdit('new')}>Novo lançamento</Button>
        </>} />

      {/* últimos 12 meses: clique para abrir o mês */}
      {monthList.length > 0 && (
        <Card sx={{ mb: 1.75 }}><CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Typography variant="caption" component="div" sx={{ mb: 1 }}>Despesas líquidas · últimos 12 meses</Typography>
          <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 0.5 }}>
            {monthList.map((m) => {
              const sel = m.month === month;
              return (
                <ButtonBase key={m.month} onClick={() => setMonth(m.month)} aria-pressed={sel} aria-label={`${monthLabel(m.month)}: ${brl(m.net)}`}
                  sx={{ flexDirection: 'column', alignItems: 'stretch', minWidth: 68, p: 0.75, borderRadius: 1, border: 1, borderColor: sel ? 'primary.main' : 'divider' }}>
                  <Box sx={{ height: 36, display: 'flex', alignItems: 'flex-end' }}><Box sx={{ width: '100%', height: `${Math.max(2, (Math.max(0, m.net) / maxNet) * 36)}px`, bgcolor: sel ? 'primary.main' : 'action.selected', borderRadius: 0.5 }} /></Box>
                  <Typography variant="caption" sx={{ mt: 0.5, textAlign: 'center' }}>{MES3[+m.month.slice(5, 7) - 1]}/{m.month.slice(2, 4)}</Typography>
                  <Typography sx={{ fontSize: 11.5, fontWeight: 600, textAlign: 'center' }} noWrap>{m.count ? brl(m.net).replace(/,\d\d$/, '') : '—'}</Typography>
                </ButtonBase>
              );
            })}
          </Stack>
        </CardContent></Card>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, mb: 1.75 }}>
        <Stack direction="row" sx={{ alignItems: 'center' }}>
          <IconButton aria-label="Mês anterior" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeftRoundedIcon /></IconButton>
          <Typography sx={{ minWidth: 170, textAlign: 'center', fontWeight: 600 }}>{cap(monthLabel(month))}</Typography>
          <IconButton aria-label="Próximo mês" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRightRoundedIcon /></IconButton>
        </Stack>
        <TextField select size="small" label="Cartão" value={card} onChange={(e) => setCard(e.target.value)} sx={{ minWidth: 220 }} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
          <MenuItem value="">Todos os cartões</MenuItem>
          {(cards.data?.cards ?? []).map((c) => <MenuItem key={c.id} value={c.id}>{cardLabel(c)}</MenuItem>)}
          <MenuItem value="none">Sem cartão</MenuItem>
        </TextField>
      </Stack>

      <Tabs value={view} onChange={(_, v) => setView(v)} sx={{ mb: 1.75, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="lancamentos" label="Lançamentos" />
        <Tab value="origem" label="Por origem" />
      </Tabs>

      {view === 'origem' ? <OriginsSection month={month} card={card} cards={cards.data?.cards ?? []} /> : error ? <ErrorBox error={error} retry={() => refetch()} /> : !data ? <PageSkeleton /> : (
        <>
          <Grid container spacing={1.75} sx={{ mb: 1.75 }}>
            {[
              ['Despesas', brl(data.totals.expenses)],
              ['Estornos / créditos', brl(-data.totals.credits)],
              ['Líquido do mês', brl(data.totals.net)],
              ['Pagamentos de fatura (fora da soma)', brl(data.totals.payments)],
            ].map(([l, v]) => <Grid key={l} size={{ xs: 6, md: 3 }}><Card><CardContent><Stat label={l} big>{v}</Stat></CardContent></Card></Grid>)}
          </Grid>
          {data.entries.length === 0 ? (
            <Alert severity="info">Nenhum lançamento com compra em {monthLabel(month)}. Envie a fatura em <b>Enviar fatura (PDF)</b> ou use <b>Novo lançamento</b>.</Alert>
          ) : (
            <TableContainer component={Card}><Table size="small">
              <TableHead><TableRow>{['Data', 'Descrição', 'Origem', 'Cartão', 'Tipo', 'Valor', ''].map((h, i) => <TableCell key={i} align={h === 'Valor' ? 'right' : 'left'}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>{data.entries.map((e) => {
                const c = e.cardId ? cardById.get(e.cardId) : null;
                return (
                  <TableRow key={e.id} sx={{ opacity: e.excluded ? 0.5 : 1 }}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{ddmm(e.date)}</TableCell>
                    <TableCell sx={{ whiteSpace: 'normal', minWidth: 180 }}>
                      {e.description}{e.installmentN && <Typography component="span" variant="caption"> · parcela {e.installmentN}/{e.installmentTotal}</Typography>}
                      {e.category && <Typography variant="caption" component="div">{e.category}</Typography>}
                    </TableCell>
                    <TableCell><Typography variant="caption">{e.merchantKey}</Typography></TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{c ? cardLabel(c) : '—'}</TableCell>
                    <TableCell>{e.kind === 'purchase' ? <Typography variant="caption">Compra</Typography> : <Tag tone={e.kind === 'refund' ? 'pos' : e.kind === 'payment' ? 'na' : 'warn'}>{KIND_LABEL[e.kind]}</Tag>}{e.excluded && <> <Tag>fora da soma</Tag></>}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {e.kind === 'payment' ? <Typography component="span" color="text.secondary">{brl(e.amount)}</Typography> : brl(e.signedAmount)}
                      {e.amountOriginal != null && <Typography variant="caption" component="div">{e.currencyOriginal} {e.amountOriginal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</Typography>}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Tooltip title={e.excluded ? 'Voltar a somar' : 'Tirar das somas (sem apagar)'}><IconButton size="small" aria-label={`${e.excluded ? 'Voltar a somar' : 'Tirar das somas'}: ${e.description}`} disabled={toggle.isPending} onClick={() => setExcluded(e, !e.excluded)}><VisibilityOffOutlinedIcon fontSize="small" color={e.excluded ? 'primary' : undefined} /></IconButton></Tooltip>
                      <Tooltip title="Editar"><IconButton size="small" aria-label={`Editar ${e.description}`} onClick={() => setEdit(e)}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Excluir"><IconButton size="small" aria-label={`Excluir ${e.description}`} onClick={() => setDel(e)}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}</TableBody>
            </Table></TableContainer>
          )}
        </>
      )}

      {edit && <EntryDialog key={edit === 'new' ? 'new' : edit.id} entry={edit === 'new' ? null : edit} cards={cards.data?.cards ?? []} defaultMonth={month} defaultCard={card && card !== 'none' ? card : ''}
        onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); setToast('Lançamento salvo'); if (m !== month) setMonth(m); }} />}
      {cardsOpen && <CardsDialog cards={cards.data?.cards ?? []} onClose={() => setCardsOpen(false)} />}
      <ConfirmDialog open={!!del} title="Excluir lançamento?" busy={remove.isPending} onClose={() => setDel(null)}
        onConfirm={() => del && remove.mutate(del.id, { onSuccess: () => { setDel(null); setToast('Lançamento excluído'); }, onError: (err) => setToast(err instanceof ApiError ? err.message : 'Não foi possível excluir.') })}>
        {del && <>“{del.description}” de {ddmm(del.date)} ({brl(del.amount)}) será apagado. Para só tirar das somas, use o botão de ocultar.</>}
      </ConfirmDialog>
      <Snackbar open={!!toast} autoHideDuration={3500} onClose={() => setToast('')} message={toast} />
    </>
  );
}

const toInput = (e: CashflowEntry): CashflowEntryInput => ({
  date: e.date, description: e.description, kind: e.kind, amount: e.amount, cardId: e.cardId, installmentN: e.installmentN, installmentTotal: e.installmentTotal,
  amountOriginal: e.amountOriginal, currencyOriginal: e.currencyOriginal, category: e.category, note: e.note, excluded: e.excluded,
});
const fmtNum = (v: number | null | undefined) => (v == null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function EntryDialog({ entry, cards, defaultMonth, defaultCard, onClose, onSaved }: { entry: CashflowEntry | null; cards: CashflowCard[]; defaultMonth: string; defaultCard: string; onClose: () => void; onSaved: (month: string) => void }) {
  const now = new Date();
  const today = `${thisMonth()}-${String(now.getDate()).padStart(2, '0')}`;
  const [f, setF] = useState({
    date: entry?.date ?? (today.startsWith(defaultMonth) ? today : `${defaultMonth}-01`),
    description: entry?.description ?? '', kind: entry?.kind ?? ('purchase' as CashflowKind), amount: fmtNum(entry?.amount), cardId: entry?.cardId ?? defaultCard,
    installmentN: entry?.installmentN ? String(entry.installmentN) : '', installmentTotal: entry?.installmentTotal ? String(entry.installmentTotal) : '',
    amountOriginal: fmtNum(entry?.amountOriginal), currencyOriginal: entry?.currencyOriginal ?? '', category: entry?.category ?? '', note: entry?.note ?? '', excluded: entry?.excluded ?? false,
  });
  const [err, setErr] = useState('');
  const add = useAdminMutation(cashflowApi.addEntry, INV);
  const upd = useAdminMutation(cashflowApi.updateEntry, INV);
  const busy = add.isPending || upd.isPending;

  const save = () => {
    const amount = parseNum(f.amount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return setErr('Informe a data da compra.');
    if (!f.description.trim()) return setErr('Informe a descrição.');
    if (!(amount > 0)) return setErr('Informe um valor maior que zero (o tipo define se é despesa ou estorno).');
    const n = f.installmentN ? Number(f.installmentN) : null, total = f.installmentTotal ? Number(f.installmentTotal) : null;
    if ((n == null) !== (total == null) || (n != null && total != null && (n < 1 || n > total))) return setErr('Parcela: informe "n de N", com n entre 1 e N.');
    const orig = f.amountOriginal ? parseNum(f.amountOriginal) : null, cur = f.currencyOriginal.trim().toUpperCase() || null;
    if ((orig == null) !== (cur == null) || (orig != null && !(orig > 0)) || (cur != null && !/^[A-Z]{3}$/.test(cur))) return setErr('Valor original: informe valor e moeda (ex.: USD) juntos.');
    const body: CashflowEntryInput = { date: f.date, description: f.description.trim(), kind: f.kind, amount, cardId: f.cardId || null, installmentN: n, installmentTotal: total, amountOriginal: orig, currencyOriginal: cur, category: f.category.trim() || null, note: f.note.trim() || null, excluded: f.excluded };
    const done = { onSuccess: () => onSaved(f.date.slice(0, 7)), onError: (e: Error) => setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.') };
    if (entry) upd.mutate({ id: entry.id, ...body }, done); else add.mutate(body, done);
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{entry ? 'Editar lançamento' : 'Novo lançamento'}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.75} sx={{ pt: 1 }}>
          {entry?.descriptionRaw && <Typography variant="caption">Na fatura: {entry.descriptionRaw}</Typography>}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField size="small" type="date" label="Data da compra" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField select size="small" label="Tipo" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as CashflowKind })} sx={{ flex: 1 }}>
              {(Object.keys(KIND_LABEL) as CashflowKind[]).map((k) => <MenuItem key={k} value={k}>{KIND_LABEL[k]}</MenuItem>)}
            </TextField>
          </Stack>
          <TextField size="small" label="Descrição" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ex.: FACEBK *2X8YZ9ABC2" autoFocus slotProps={{ htmlInput: { maxLength: 200 } }}
            helperText="A origem (para somar o mês) sai da descrição: “FACEBK *2X8Y…” e “FACEBK *K7QW…” contam juntas." />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField size="small" label="Valor (R$)" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} inputMode="decimal" placeholder="0,00" sx={{ flex: 1 }} />
            <TextField select size="small" label="Cartão" value={f.cardId} onChange={(e) => setF({ ...f, cardId: e.target.value })} sx={{ flex: 1.4 }} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
              <MenuItem value="">Sem cartão</MenuItem>
              {cards.map((c) => <MenuItem key={c.id} value={c.id}>{cardLabel(c)}</MenuItem>)}
            </TextField>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField size="small" label="Parcela" value={f.installmentN} onChange={(e) => setF({ ...f, installmentN: e.target.value.replace(/\D/g, '').slice(0, 2) })} placeholder="3" inputMode="numeric" sx={{ width: { sm: 90 } }} />
            <TextField size="small" label="de" value={f.installmentTotal} onChange={(e) => setF({ ...f, installmentTotal: e.target.value.replace(/\D/g, '').slice(0, 2) })} placeholder="10" inputMode="numeric" sx={{ width: { sm: 90 } }} />
            <TextField size="small" label="Valor original" value={f.amountOriginal} onChange={(e) => setF({ ...f, amountOriginal: e.target.value })} placeholder="compra no exterior" inputMode="decimal" sx={{ flex: 1 }} />
            <TextField size="small" label="Moeda" value={f.currencyOriginal} onChange={(e) => setF({ ...f, currencyOriginal: e.target.value.toUpperCase().slice(0, 3) })} placeholder="USD" sx={{ width: { sm: 90 } }} />
          </Stack>
          <TextField size="small" label="Categoria (opcional)" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} slotProps={{ htmlInput: { maxLength: 60 } }} />
          <TextField size="small" label="Observação (opcional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 300 } }} />
          <FormControlLabel control={<Checkbox checked={f.excluded} onChange={(_, v) => setF({ ...f, excluded: v })} />} label="Fora das somas (fica na lista, mas não conta nos totais)" />
          {err && <Alert severity="error">{err}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Cancelar</Button><Button variant="contained" onClick={save} disabled={busy}>Salvar</Button></DialogActions>
    </Dialog>
  );
}

function CardsDialog({ cards, onClose }: { cards: CashflowCard[]; onClose: () => void }) {
  const empty = { issuer: '', nickname: '', last4: '' };
  const [f, setF] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [del, setDel] = useState<CashflowCard | null>(null);
  const [err, setErr] = useState('');
  const add = useAdminMutation(cashflowApi.addCard, INV);
  const upd = useAdminMutation(cashflowApi.updateCard, INV);
  const remove = useAdminMutation(cashflowApi.deleteCard, INV);

  const save = () => {
    if (!f.issuer.trim()) return setErr('Informe o emissor (ex.: Nubank).');
    if (f.last4 && !/^\d{4}$/.test(f.last4)) return setErr('Final do cartão: só os 4 últimos dígitos.');
    const body = { issuer: f.issuer.trim(), nickname: f.nickname.trim() || null, last4: f.last4 || null };
    const done = { onSuccess: () => { setF(empty); setEditing(null); setErr(''); }, onError: (e: Error) => setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.') };
    if (editing) upd.mutate({ id: editing, ...body }, done); else add.mutate(body, done);
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Cartões</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Guarde só o emissor, um apelido e os 4 últimos dígitos — nunca o número completo.</Typography>
        {cards.length > 0 && (
          <Table size="small" sx={{ mb: 2 }}><TableBody>{cards.map((c) => (
            <TableRow key={c.id} selected={editing === c.id}>
              <TableCell>{cardLabel(c)}</TableCell>
              <TableCell><Typography variant="caption">{c.entryCount} lançamento{c.entryCount === 1 ? '' : 's'}</Typography></TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                <IconButton size="small" aria-label={`Editar ${cardLabel(c)}`} onClick={() => { setEditing(c.id); setF({ issuer: c.issuer, nickname: c.nickname ?? '', last4: c.last4 ?? '' }); setErr(''); }}><EditOutlinedIcon fontSize="small" /></IconButton>
                <IconButton size="small" aria-label={`Excluir ${cardLabel(c)}`} onClick={() => setDel(c)}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton>
              </TableCell>
            </TableRow>
          ))}</TableBody></Table>
        )}
        <Typography variant="subtitle2" sx={{ mb: 1 }}>{editing ? 'Editar cartão' : 'Adicionar cartão'}</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField size="small" label="Emissor" value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} placeholder="Nubank" sx={{ flex: 1 }} slotProps={{ htmlInput: { maxLength: 60 } }} />
          <TextField size="small" label="Apelido (opcional)" value={f.nickname} onChange={(e) => setF({ ...f, nickname: e.target.value })} placeholder="Empresa" sx={{ flex: 1 }} slotProps={{ htmlInput: { maxLength: 60 } }} />
          <TextField size="small" label="Final" value={f.last4} onChange={(e) => setF({ ...f, last4: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="1234" inputMode="numeric" sx={{ width: { sm: 90 } }} />
        </Stack>
        {err && <Alert severity="error" sx={{ mt: 1.5 }}>{err}</Alert>}
      </DialogContent>
      <DialogActions>
        {editing && <Button onClick={() => { setEditing(null); setF(empty); setErr(''); }}>Cancelar edição</Button>}
        <Button variant="contained" onClick={save} disabled={add.isPending || upd.isPending}>{editing ? 'Salvar cartão' : 'Adicionar'}</Button>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
      <ConfirmDialog open={!!del} title="Excluir cartão?" busy={remove.isPending} onClose={() => setDel(null)}
        onConfirm={() => del && remove.mutate(del.id, { onSuccess: () => { if (editing === del.id) { setEditing(null); setF(empty); } setDel(null); }, onError: (e) => { setDel(null); setErr(e instanceof ApiError ? e.message : 'Não foi possível excluir.'); } })}>
        {del && <>{cardLabel(del)} será excluído. Os {del.entryCount} lançamento(s) dele continuam, como “sem cartão”.</>}
      </ConfirmDialog>
    </Dialog>
  );
}
