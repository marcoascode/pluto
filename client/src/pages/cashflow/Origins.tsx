import { Alert, Box, Button, Card, CardContent, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, IconButton, MenuItem, Snackbar, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded';
import LabelOutlinedIcon from '@mui/icons-material/LabelOutlined';
import RuleRoundedIcon from '@mui/icons-material/RuleRounded';
import { Fragment, useState } from 'react';
import { useAdminMutation, useCashflowOrigins, useCashflowRules } from '@/hooks/queries';
import { cashflowApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';
import { ddmm, money } from '@/lib/format';
import { ConfirmDialog, ErrorBox, PageSkeleton, Stat, Tag } from '@/components/ui/States';
import type { CashflowCard, CashflowOriginGroup, CashflowRule, CashflowRuleInput, CashflowRuleMatch } from '@/types/api';

/**
 * 0.18.17 · Fluxo de caixa → Por origem. Soma, no mês da data da compra, as despesas da mesma origem vindas de faturas
 * e cartões diferentes (ex.: todas as "FACEBK *…" = campanhas no Facebook). Regras do usuário dão nome e juntam origens.
 */
const INV = [qk.cashflow];
const brl = (v: number) => money(v, 'BRL');
export const MATCH_LABEL: Record<CashflowRuleMatch, string> = { key: 'Origem exata', starts: 'Começa com', contains: 'Contém' };
const cardShort = (c: CashflowCard) => [c.nickname || c.issuer, c.last4 && `•••• ${c.last4}`].filter(Boolean).join(' ');

export function OriginsSection({ month, card, cards }: { month: string; card: string; cards: CashflowCard[] }) {
  const { data, error, refetch } = useCashflowOrigins(month, card);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [onlyMulti, setOnlyMulti] = useState(false);
  const [rule, setRule] = useState<{ rule: CashflowRule | null; draft: CashflowRuleInput } | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [toast, setToast] = useState('');
  const rules = useCashflowRules();
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const multi = (g: CashflowOriginGroup) => g.statements.length + (g.manualCount ? 1 : 0) > 1 || g.cardIds.length > 1;

  const editGroup = (g: CashflowOriginGroup) => {
    const r = g.ruleId ? rules.data?.rules.find((x) => x.id === g.ruleId) ?? null : null;
    setRule(r ? { rule: r, draft: { match: r.match, pattern: r.pattern, name: r.name, category: r.category } }
      : { rule: null, draft: { match: 'key', pattern: g.merchantKeys[0] ?? g.name, name: '', category: null } });
  };

  if (error) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  const groups = onlyMulti ? data.groups.filter(multi) : data.groups;
  const delta = data.total - data.prevTotal;

  return (
    <>
      <Grid container spacing={1.75} sx={{ mb: 1.75 }}>
        <Grid size={{ xs: 6, md: 3 }}><Card><CardContent><Stat label="Despesas líquidas do mês" big>{brl(data.total)}</Stat></CardContent></Card></Grid>
        <Grid size={{ xs: 6, md: 3 }}><Card><CardContent><Stat label="Mês anterior" big>{brl(data.prevTotal)}</Stat>
          {data.prevTotal > 0 && <Typography variant="caption" color={delta > 0 ? 'error.main' : 'success.main'}>{delta > 0 ? '+' : ''}{brl(delta)}</Typography>}</CardContent></Card></Grid>
        <Grid size={{ xs: 6, md: 3 }}><Card><CardContent><Stat label="Origens no mês" big>{data.groupCount}</Stat></CardContent></Card></Grid>
        <Grid size={{ xs: 6, md: 3 }}><Card><CardContent><Stat label="Somando faturas/cartões diferentes" big>{data.multiSourceCount}</Stat></CardContent></Card></Grid>
      </Grid>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, mb: 1.5 }}>
        <FormControlLabel control={<Switch checked={onlyMulti} onChange={(_, v) => setOnlyMulti(v)} />} label="Só origens que somam mais de uma fatura ou cartão" />
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" startIcon={<RuleRoundedIcon />} onClick={() => setRulesOpen(true)}>Regras de origem{rules.data?.rules.length ? ` (${rules.data.rules.length})` : ''}</Button>
      </Stack>

      {groups.length === 0 ? (
        <Alert severity="info">{data.groups.length ? 'Nenhuma origem deste mês soma mais de uma fatura ou cartão.' : 'Nenhuma despesa com compra neste mês.'}</Alert>
      ) : (
        <TableContainer component={Card}><Table size="small">
          <TableHead><TableRow>
            <TableCell padding="checkbox" />
            {['Origem', 'Lançamentos', 'De onde veio', 'Mês anterior', 'Total do mês', ''].map((h, i) => <TableCell key={i} align={h === 'Total do mês' || h === 'Mês anterior' ? 'right' : 'left'}>{h}</TableCell>)}
          </TableRow></TableHead>
          <TableBody>{groups.map((g) => {
            const isOpen = open.has(g.key);
            const share = data.total > 0 ? Math.max(0, g.total / data.total) : 0;
            return (
              <Fragment key={g.key}>
                <TableRow hover sx={{ cursor: 'pointer', '& > td': { borderBottom: isOpen ? 0 : undefined } }} onClick={() => toggle(g.key)}>
                  <TableCell padding="checkbox"><IconButton size="small" aria-label={`${isOpen ? 'Recolher' : 'Ver lançamentos de'} ${g.name}`} aria-expanded={isOpen}>{isOpen ? <KeyboardArrowDownRoundedIcon fontSize="small" /> : <KeyboardArrowRightRoundedIcon fontSize="small" />}</IconButton></TableCell>
                  <TableCell sx={{ minWidth: 200 }}>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                      <Typography sx={{ fontWeight: 600 }}>{g.name}</Typography>
                      {g.ruleId && <Tooltip title={`Regra: ${MATCH_LABEL[g.rule!.match].toLowerCase()} “${g.rule!.pattern}”`}><LabelOutlinedIcon sx={{ fontSize: 16, color: 'primary.main' }} /></Tooltip>}
                    </Stack>
                    <Typography variant="caption" component="div">{[g.category, g.ruleId || g.merchantKeys.length > 1 ? g.merchantKeys.join(' · ') : null].filter(Boolean).join(' — ')}</Typography>
                    <Box sx={{ mt: 0.5, height: 3, width: 140, bgcolor: 'action.hover', borderRadius: 1 }}><Box sx={{ height: 3, width: `${share * 100}%`, bgcolor: 'primary.main', borderRadius: 1 }} /></Box>
                  </TableCell>
                  <TableCell>{g.count}{g.credits > 0 && <Typography variant="caption" component="div">estornos {brl(-g.credits)}</Typography>}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      {g.statements.length > 0 && <Chip size="small" label={`${g.statements.length} fatura${g.statements.length > 1 ? 's' : ''}`} color={g.statements.length > 1 ? 'primary' : 'default'} variant={g.statements.length > 1 ? 'filled' : 'outlined'} />}
                      {g.cardIds.length > 1 && <Chip size="small" color="primary" label={`${g.cardIds.length} cartões`} />}
                      {g.manualCount > 0 && <Chip size="small" variant="outlined" label={`${g.manualCount} manua${g.manualCount > 1 ? 'is' : 'l'}`} />}
                    </Stack>
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>{g.prevTotal ? brl(g.prevTotal) : '—'}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{brl(g.total)}</TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <Tooltip title={g.ruleId ? 'Editar a regra desta origem' : 'Dar nome / juntar com outras origens'}>
                      <IconButton size="small" aria-label={g.ruleId ? `Editar regra de ${g.name}` : `Dar nome à origem ${g.name}`} onClick={() => editGroup(g)}>{g.ruleId ? <EditOutlinedIcon fontSize="small" /> : <LabelOutlinedIcon fontSize="small" />}</IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={7} sx={{ py: 0, ...(isOpen ? {} : { borderBottom: 0 }) }}>
                    <Collapse in={isOpen} unmountOnExit>
                      <Table size="small" sx={{ mb: 1.5, '& td': { fontSize: 12.5 } }}>
                        <TableBody>{g.entries.map((e) => {
                          const c = e.cardId ? cardById.get(e.cardId) : null;
                          const st = e.statementId ? g.statements.find((s) => s.id === e.statementId) : null;
                          return (
                            <TableRow key={e.id}>
                              <TableCell sx={{ width: 64 }}>{ddmm(e.date)}</TableCell>
                              <TableCell>{e.description}{e.installmentN && <Typography component="span" variant="caption"> · parcela {e.installmentN}/{e.installmentTotal}</Typography>}{e.kind !== 'purchase' && <> <Tag tone={e.kind === 'refund' ? 'pos' : 'warn'}>{e.kind === 'refund' ? 'estorno' : e.kind === 'iof' ? 'IOF' : e.kind === 'fee' ? 'tarifa' : 'juros'}</Tag></>}</TableCell>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>{c ? cardShort(c) : '—'}</TableCell>
                              <TableCell sx={{ maxWidth: 220 }}><Typography variant="caption" noWrap component="div" title={st?.filename}>{st ? st.filename : 'lançamento manual'}</Typography></TableCell>
                              <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{brl(e.signedAmount)}</TableCell>
                            </TableRow>
                          );
                        })}</TableBody>
                      </Table>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </Fragment>
            );
          })}</TableBody>
        </Table></TableContainer>
      )}

      {rule && <RuleDialog rule={rule.rule} draft={rule.draft} onClose={() => setRule(null)} onSaved={() => { setRule(null); setToast('Regra salva: a soma por origem foi refeita'); }} />}
      {rulesOpen && <RulesDialog rules={rules.data?.rules ?? []} onClose={() => setRulesOpen(false)} onEdit={(r) => setRule(r ? { rule: r, draft: { match: r.match, pattern: r.pattern, name: r.name, category: r.category } } : { rule: null, draft: { match: 'starts', pattern: '', name: '', category: null } })} />}
      <Snackbar open={!!toast} autoHideDuration={3500} onClose={() => setToast('')} message={toast} />
    </>
  );
}

function RuleDialog({ rule, draft, onClose, onSaved }: { rule: CashflowRule | null; draft: CashflowRuleInput; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ ...draft, category: draft.category ?? '' });
  const [err, setErr] = useState('');
  const add = useAdminMutation(cashflowApi.addRule, INV);
  const upd = useAdminMutation(cashflowApi.updateRule, INV);
  const save = () => {
    if (f.pattern.trim().length < 2) return setErr('O padrão precisa de 2 caracteres ou mais.');
    if (!f.name.trim()) return setErr('Dê um nome para a origem (ex.: Facebook Ads).');
    const body: CashflowRuleInput = { match: f.match, pattern: f.pattern.trim(), name: f.name.trim(), category: f.category.trim() || null };
    const done = { onSuccess: onSaved, onError: (e: Error) => setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.') };
    if (rule) upd.mutate({ id: rule.id, ...body }, done); else add.mutate(body, done);
  };
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{rule ? 'Editar regra de origem' : 'Nova regra de origem'}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.75} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            A regra dá um nome à origem e junta, na soma do mês, tudo o que ela pegar — de qualquer fatura ou cartão, inclusive meses anteriores.
            Ex.: origem exata <b>FACEBK</b> → “Facebook Ads (campanhas)”; começa com <b>UBER</b> → “Transporte”.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField select size="small" label="Tipo" value={f.match} onChange={(e) => setF({ ...f, match: e.target.value as CashflowRuleMatch })} sx={{ minWidth: 160 }}>
              {(Object.keys(MATCH_LABEL) as CashflowRuleMatch[]).map((k) => <MenuItem key={k} value={k}>{MATCH_LABEL[k]}</MenuItem>)}
            </TextField>
            <TextField size="small" label="Padrão" value={f.pattern} onChange={(e) => setF({ ...f, pattern: e.target.value.toUpperCase() })} placeholder="FACEBK" sx={{ flex: 1 }} slotProps={{ htmlInput: { maxLength: 120 } }}
              helperText={f.match === 'key' ? 'Igual à coluna Origem.' : 'Comparado com a origem e com a descrição da fatura (sem acento).'} />
          </Stack>
          <TextField size="small" label="Nome da origem" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Como a origem aparece na soma (ex.: Transporte)" autoFocus slotProps={{ htmlInput: { maxLength: 80 } }} />
          <TextField size="small" label="Categoria (opcional)" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Marketing" slotProps={{ htmlInput: { maxLength: 60 } }} />
          {err && <Alert severity="error">{err}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Cancelar</Button><Button variant="contained" onClick={save} disabled={add.isPending || upd.isPending}>Salvar regra</Button></DialogActions>
    </Dialog>
  );
}

function RulesDialog({ rules, onClose, onEdit }: { rules: CashflowRule[]; onClose: () => void; onEdit: (r: CashflowRule | null) => void }) {
  const [del, setDel] = useState<CashflowRule | null>(null);
  const remove = useAdminMutation(cashflowApi.deleteRule, INV);
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Regras de origem</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Aplicadas nesta ordem: origem exata primeiro; depois “começa com” e “contém”, do padrão mais longo para o mais curto. Valem para todos os meses e não alteram os lançamentos.</Typography>
        {rules.length === 0 ? <Alert severity="info">Nenhuma regra ainda. Na lista “Por origem”, use o ícone de etiqueta de uma origem para dar nome a ela.</Alert> : (
          <Table size="small"><TableHead><TableRow>{['Tipo', 'Padrão', 'Nome', 'Categoria', 'Lançamentos', ''].map((h, i) => <TableCell key={i}>{h}</TableCell>)}</TableRow></TableHead>
            <TableBody>{rules.map((r) => (
              <TableRow key={r.id}>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{MATCH_LABEL[r.match]}</TableCell>
                <TableCell><Typography variant="body2" sx={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12.5 }}>{r.pattern}</Typography></TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.category ?? '—'}</TableCell>
                <TableCell>{r.matches ?? 0}</TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <IconButton size="small" aria-label={`Editar regra ${r.name}`} onClick={() => onEdit(r)}><EditOutlinedIcon fontSize="small" /></IconButton>
                  <IconButton size="small" aria-label={`Excluir regra ${r.name}`} onClick={() => setDel(r)}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </DialogContent>
      <DialogActions><Button onClick={() => onEdit(null)}>Nova regra</Button><Button variant="contained" onClick={onClose}>Fechar</Button></DialogActions>
      <ConfirmDialog open={!!del} title="Excluir regra?" busy={remove.isPending} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id, { onSuccess: () => setDel(null) })}>
        {del && <>As origens que a regra “{del.name}” juntava voltam a aparecer separadas. Os lançamentos não mudam.</>}
      </ConfirmDialog>
    </Dialog>
  );
}
