/**
 * 0.17 — Contas × Sites.
 *  - Vínculos: cada conta Google/Meta paga um ou mais sites. Ao mudar, a despesa ATÉ o dia anterior fica no site antigo e a
 *    partir da data da mudança vai para o novo. Data editável só por Gerente/Admin/SuperAdmin (o Gestor muda sempre "a partir de hoje").
 *  - Atribuição: Gerente/Admin/SuperAdmin entregam domínios e contas a cada gestor; o gestor só vê e só liga o que é dele.
 */
import {
  Alert, Autocomplete, Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, Stack, Tab, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import GoogleIcon from '@mui/icons-material/Google';
import FacebookRoundedIcon from '@mui/icons-material/FacebookRounded';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog, ErrorBox, PageHead, PageSkeleton, Tag } from '@/components/ui/States';
import { ApiError } from '@/lib/api/client';
import { linksApi, type GestorAssign, type LinkAccount, type LinkDomain, type LinksResponse } from '@/lib/links';

const br = (iso?: string | null) => (iso ? iso.split('-').reverse().join('/') : '');
const ALWAYS = '2000-01-01';
const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Não foi possível salvar.');
const ProvIcon = ({ p }: { p: string }) => (p === 'meta' ? <FacebookRoundedIcon sx={{ fontSize: 16, color: '#4f8cff' }} /> : <GoogleIcon sx={{ fontSize: 16, color: '#f5b84a' }} />);

function useInvalidate() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['links'] }), qc.invalidateQueries({ queryKey: ['admin'] }), qc.invalidateQueries({ queryKey: ['accounts'] })]);
}

/* ---------------- editar vínculo ---------------- */
function LinkDialog({ a, data, onClose }: { a: LinkAccount; data: LinksResponse; onClose: () => void }) {
  const { viewer, domains } = data;
  const inv = useInvalidate();
  const locked = a.domains.filter((d) => !d.editable);
  const [sel, setSel] = useState<LinkDomain[]>(domains.filter((d) => a.domains.some((x) => x.editable && x.id === d.id)));
  const [from, setFrom] = useState(viewer.today);
  const [err, setErr] = useState('');
  const m = useMutation({ mutationFn: linksApi.link, onSuccess: async () => { await inv(); onClose(); }, onError: (e) => setErr(msg(e)) });
  const changed = sel.map((d) => d.id).sort().join() !== a.domains.filter((d) => d.editable).map((d) => d.id).sort().join();
  const future = from > viewer.today;
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><ProvIcon p={a.provider} /> {a.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Autocomplete multiple size="small" options={domains.filter((d) => d.active !== false)} getOptionLabel={(o) => o.hostname} isOptionEqualToValue={(o, v) => o.id === v.id}
            value={sel} onChange={(_, v) => setSel(v)} renderInput={(p) => <TextField {...p} label="Sites que esta conta paga" placeholder={sel.length ? '' : 'Nenhum site'} />} />
          {locked.length > 0 && (
            <Alert severity="info" icon={<LockOutlinedIcon fontSize="small" />}>
              Também ligada a {locked.map((d) => d.hostname).join(', ')}. Esse vínculo não é seu e continua como está.
            </Alert>
          )}
          {viewer.canDate ? (
            <TextField size="small" type="date" label="A mudança vale a partir de" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: viewer.today } }}
              error={future} helperText={future ? 'A data não pode ser no futuro.' : `A despesa até ${br(from) ? 'o dia anterior a ' + br(from) : 'o dia anterior'} continua no site de antes. Use uma data passada para corrigir um vínculo que mudou e não foi registrado.`} />
          ) : (
            <Alert severity="info">A mudança vale a partir de hoje ({br(viewer.today)}). A despesa até ontem continua no site de antes. Só Gerente, Admin ou SuperAdmin mudam essa data.</Alert>
          )}
          <Typography variant="caption" color="text.secondary">Depois de salvar, a sincronização da conta roda de novo para redistribuir a despesa dos dias recentes.</Typography>
          {err && <Alert severity="error">{err}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" disabled={m.isPending || future || (!changed && !(viewer.canDate && from !== viewer.today))}
          onClick={() => m.mutate({ accountId: a.id, domainIds: sel.map((d) => d.id), ...(viewer.canDate ? { from } : {}) })}>Salvar vínculo</Button>
      </DialogActions>
    </Dialog>
  );
}

/* ---------------- histórico ---------------- */
function HistoryDialog({ a, data, onClose }: { a: LinkAccount; data: LinksResponse; onClose: () => void }) {
  const { viewer } = data;
  const inv = useInvalidate();
  const [edit, setEdit] = useState<{ id: string; from: string } | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const save = useMutation({ mutationFn: linksApi.editHistory, onSuccess: async () => { setEdit(null); setErr(''); await inv(); }, onError: (e) => setErr(msg(e)) });
  const rm = useMutation({ mutationFn: linksApi.deleteHistory, onSuccess: async () => { setDel(null); setErr(''); await inv(); }, onError: (e) => { setDel(null); setErr(msg(e)); } });
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><HistoryRoundedIcon fontSize="small" /> Histórico · {a.name}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Em cada dia, a despesa da conta vai para os sites do período que vale naquele dia.{viewer.canDate ? ' Corrija a data de uma mudança ou exclua uma mudança registrada por engano.' : ''}
        </Typography>
        {!a.history.length && <Alert severity="info">Sem mudanças registradas. A despesa segue o site encontrado pela campanha.</Alert>}
        <Stack spacing={1}>
          {a.history.map((h) => {
            const current = h === a.history.find((x) => x.from <= viewer.today);
            return (
              <Card key={h.id} variant="outlined" sx={{ p: 1.25, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box sx={{ minWidth: 150 }}>
                  {edit?.id === h.id ? (
                    <TextField size="small" type="date" value={edit.from} onChange={(e) => setEdit({ id: h.id, from: e.target.value })} slotProps={{ htmlInput: { max: viewer.today } }} />
                  ) : (
                    <Typography sx={{ fontWeight: 600, fontSize: 13.5 }}>{h.from === ALWAYS ? 'Desde sempre' : `A partir de ${br(h.from)}`}</Typography>
                  )}
                  {current && <Tag tone="pos">vale hoje</Tag>}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap" }}>{h.domains.length ? h.domains.map((d) => <Chip key={d} size="small" label={d} />) : <Typography variant="caption" color="text.secondary">nenhum site</Typography>}</Stack>
                  {(h.by || h.from !== ALWAYS) && <Typography variant="caption" color="text.secondary">{h.by ? `por ${h.by} · ` : ''}registrado em {new Date(h.at).toLocaleDateString('pt-BR')}</Typography>}
                </Box>
                {viewer.canDate && h.from !== ALWAYS && (edit?.id === h.id ? (
                  <Tooltip title="Salvar data"><span><IconButton size="small" color="primary" disabled={save.isPending || edit.from > viewer.today || !edit.from} onClick={() => save.mutate(edit)}><CheckRoundedIcon fontSize="small" /></IconButton></span></Tooltip>
                ) : (
                  <Stack direction="row">
                    <Tooltip title="Mudar a data"><IconButton size="small" onClick={() => setEdit({ id: h.id, from: h.from })}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Excluir esta mudança"><IconButton size="small" onClick={() => setDel(h.id)}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip>
                  </Stack>
                ))}
              </Card>
            );
          })}
        </Stack>
        {err && <Alert severity="error" sx={{ mt: 1.5 }}>{err}</Alert>}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Fechar</Button></DialogActions>
      <ConfirmDialog open={!!del} title="Excluir esta mudança?" busy={rm.isPending} onClose={() => setDel(null)} onConfirm={() => del && rm.mutate(del)}>
        Os dias desse período passam a seguir o período anterior. O vínculo de hoje é atualizado e a conta sincroniza de novo.
      </ConfirmDialog>
    </Dialog>
  );
}

function LinksTab({ data }: { data: LinksResponse }) {
  const [prov, setProv] = useState<'all' | 'google-ads' | 'meta'>('all');
  const [s, setS] = useState('');
  const [editing, setEditing] = useState<LinkAccount | null>(null);
  const [hist, setHist] = useState<LinkAccount | null>(null);
  const rows = useMemo(() => data.accounts.filter((a) => (prov === 'all' || a.provider === prov) && (!s || `${a.name} ${a.externalId} ${a.domains.map((d) => d.hostname).join(' ')}`.toLowerCase().includes(s.toLowerCase()))), [data, prov, s]);
  const gestor = data.viewer.role === 'gestor';
  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ mb: 1.5 }}>
        <ToggleButtonGroup size="small" exclusive value={prov} onChange={(_, v) => v && setProv(v)}>
          <ToggleButton value="all">Todas</ToggleButton><ToggleButton value="google-ads">Google Ads</ToggleButton><ToggleButton value="meta">Meta Ads</ToggleButton>
        </ToggleButtonGroup>
        <TextField size="small" placeholder="Buscar conta, ID ou site" value={s} onChange={(e) => setS(e.target.value)} sx={{ maxWidth: 320 }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> } }} />
      </Stack>
      {gestor && !data.accounts.length && <Alert severity="info" sx={{ mb: 1.5 }}>Nenhuma conta de anúncios atribuída a você ainda. Peça ao seu Gerente ou Admin.</Alert>}
      {gestor && !!data.accounts.length && !data.domains.length && <Alert severity="info" sx={{ mb: 1.5 }}>Nenhum domínio atribuído a você ainda. Peça ao seu Gerente ou Admin.</Alert>}
      <Card>
        <TableContainer>
          <Table size="small">
            <TableHead><TableRow><TableCell>Conta</TableCell><TableCell>Sites hoje</TableCell><TableCell>Desde</TableCell><TableCell align="right">Mudanças</TableCell><TableCell align="right" /></TableRow></TableHead>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id} hover>
                  <TableCell>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}><ProvIcon p={a.provider} /><Box><Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{a.name}</Typography><Typography variant="caption" color="text.secondary">{a.externalId}</Typography></Box></Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap" }}>
                      {a.domains.length ? a.domains.map((d) => (
                        <Chip key={d.id} size="small" label={d.hostname} variant={d.editable ? 'filled' : 'outlined'}
                          icon={d.editable ? undefined : <Tooltip title="Vínculo de outro responsável"><LockOutlinedIcon sx={{ fontSize: 14 }} /></Tooltip>} />
                      )) : <Tag tone="warn">sem site</Tag>}
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{a.since ? br(a.since) : <Typography variant="caption" color="text.secondary">sempre</Typography>}</TableCell>
                  <TableCell align="right">{a.history.filter((h) => h.from !== ALWAYS).length || '—'}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title="Histórico"><IconButton size="small" onClick={() => setHist(a)}><HistoryRoundedIcon fontSize="small" /></IconButton></Tooltip>
                    <Button size="small" startIcon={<EditOutlinedIcon fontSize="small" />} onClick={() => setEditing(a)} disabled={!data.domains.length}>Vincular</Button>
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length && <TableRow><TableCell colSpan={5}><Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>Nenhuma conta.</Typography></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
      {editing && <LinkDialog a={editing} data={data} onClose={() => setEditing(null)} />}
      {hist && <HistoryDialog a={data.accounts.find((x) => x.id === hist.id) ?? hist} data={data} onClose={() => setHist(null)} />}
    </>
  );
}

/* ---------------- atribuição aos gestores ---------------- */
function AssignDialog({ g, domains, accounts, onClose }: { g: GestorAssign; domains: LinkDomain[]; accounts: { id: string; name: string; provider: string }[]; onClose: () => void }) {
  const inv = useInvalidate();
  const [ds, setDs] = useState(domains.filter((d) => g.domains.includes(d.id)));
  const [as, setAs] = useState(accounts.filter((a) => g.accounts.includes(a.id)));
  const [err, setErr] = useState('');
  const m = useMutation({ mutationFn: linksApi.saveAssignment, onSuccess: async () => { await inv(); onClose(); }, onError: (e) => setErr(msg(e)) });
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{g.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Autocomplete multiple size="small" options={domains} getOptionLabel={(o) => o.hostname} isOptionEqualToValue={(o, v) => o.id === v.id} value={ds} onChange={(_, v) => setDs(v)}
            renderInput={(p) => <TextField {...p} label="Domínios do gestor" />} />
          <Autocomplete multiple size="small" options={accounts} groupBy={(o) => (o.provider === 'meta' ? 'Meta Ads' : 'Google Ads')} getOptionLabel={(o) => o.name} isOptionEqualToValue={(o, v) => o.id === v.id} value={as} onChange={(_, v) => setAs(v)}
            renderOption={({ key, ...p }, o) => <li key={key} {...p}><Stack direction="row" spacing={1} sx={{ alignItems: "center" }}><ProvIcon p={o.provider} /><span>{o.name}</span></Stack></li>}
            renderInput={(p) => <TextField {...p} label="Contas de anúncios do gestor" />} />
          {(g.otherDomains > 0 || g.otherAccounts > 0) && <Alert severity="info">Este gestor também tem {g.otherDomains} domínio(s) e {g.otherAccounts} conta(s) fora do seu alcance. Eles continuam como estão.</Alert>}
          <Typography variant="caption" color="text.secondary">O gestor passa a ver só estes domínios e contas e pode ligar as contas aos domínios dele (sempre a partir do dia em que liga).</Typography>
          {err && <Alert severity="error">{err}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" disabled={m.isPending} onClick={() => m.mutate({ userId: g.id, domainIds: ds.map((d) => d.id), accountIds: as.map((a) => a.id) })}>Salvar</Button>
      </DialogActions>
    </Dialog>
  );
}

function AssignTab() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['links', 'assignments'], queryFn: linksApi.assignments });
  const [g, setG] = useState<GestorAssign | null>(null);
  if (isLoading) return <PageSkeleton />;
  if (error || !data) return <ErrorBox error={error} retry={refetch} />;
  const host = (id: string) => data.domains.find((d) => d.id === id)?.hostname ?? id;
  const acc = (id: string) => data.accounts.find((a) => a.id === id);
  return (
    <>
      <Card>
        <TableContainer>
          <Table size="small">
            <TableHead><TableRow><TableCell>Gestor</TableCell><TableCell>Domínios</TableCell><TableCell>Contas de anúncios</TableCell><TableCell align="right" /></TableRow></TableHead>
            <TableBody>
              {data.gestores.map((x) => (
                <TableRow key={x.id} hover>
                  <TableCell><Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{x.name}</Typography><Typography variant="caption" color="text.secondary">{x.email}</Typography></TableCell>
                  <TableCell><Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap" }}>{x.domains.map((d) => <Chip key={d} size="small" label={host(d)} />)}{!x.domains.length && <Typography variant="caption" color="text.secondary">—</Typography>}{x.otherDomains > 0 && <Chip size="small" variant="outlined" label={`+${x.otherDomains} fora do seu alcance`} />}</Stack></TableCell>
                  <TableCell><Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap" }}>{x.accounts.map((a) => { const o = acc(a); return <Chip key={a} size="small" icon={<ProvIcon p={o?.provider ?? ''} />} label={o?.name ?? a} />; })}{!x.accounts.length && <Typography variant="caption" color="text.secondary">—</Typography>}{x.otherAccounts > 0 && <Chip size="small" variant="outlined" label={`+${x.otherAccounts} fora do seu alcance`} />}</Stack></TableCell>
                  <TableCell align="right"><Button size="small" startIcon={<EditOutlinedIcon fontSize="small" />} onClick={() => setG(x)}>Atribuir</Button></TableCell>
                </TableRow>
              ))}
              {!data.gestores.length && <TableRow><TableCell colSpan={4}><Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>Nenhum gestor ativo.</Typography></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
      {g && <AssignDialog g={g} domains={data.domains} accounts={data.accounts} onClose={() => setG(null)} />}
    </>
  );
}

export default function Links() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['links', 'list'], queryFn: linksApi.list });
  const [tab, setTab] = useState(0);
  if (isLoading) return <PageSkeleton />;
  if (error || !data) return <ErrorBox error={error} retry={refetch} />;
  const gestor = data.viewer.role === 'gestor';
  return (
    <Box>
      <PageHead title="Contas × Sites"
        sub={gestor ? 'Ligue as suas contas de anúncios aos seus sites. A mudança vale a partir de hoje: a despesa de antes fica no site de antes.'
          : 'Qual site cada conta de anúncios paga e desde quando. A despesa até a data da mudança fica no site antigo; a partir dela, no novo.'} />
      {data.viewer.canAssign && (
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 1.75 }}>
          <Tab label="Vínculos" /><Tab label="Atribuição aos gestores" />
        </Tabs>
      )}
      {tab === 0 ? <LinksTab data={data} /> : <AssignTab />}
    </Box>
  );
}
