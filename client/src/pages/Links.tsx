/**
 * Contas × Sites (só consulta desde a 0.18.8).
 *  - Cada conta Google/Meta paga os sites em que algum gestor a usa. Os vínculos usuário × domínio × conta são criados
 *    SÓ em Configurações → Usuários & Squads; aqui aparecem o resultado e o histórico.
 *  - Ao mudar, a despesa ATÉ o dia anterior fica no site antigo e a partir da data da mudança vai para o novo.
 *    Gerente/Admin/SuperAdmin podem corrigir a data de uma mudança (sem mudar a ordem nem o vínculo de hoje).
 */
import {
  Alert, Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import GoogleIcon from '@mui/icons-material/Google';
import FacebookRoundedIcon from '@mui/icons-material/FacebookRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorBox, PageHead, PageSkeleton, Tag } from '@/components/ui/States';
import { ApiError } from '@/lib/api/client';
import { linksApi, type LinkAccount, type LinksResponse } from '@/lib/links';

const br = (iso?: string | null) => (iso ? iso.split('-').reverse().join('/') : '');
const ALWAYS = '2000-01-01';
const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Não foi possível salvar.');
const ProvIcon = ({ p }: { p: string }) => (p === 'meta' ? <FacebookRoundedIcon sx={{ fontSize: 16, color: '#4f8cff' }} /> : <GoogleIcon sx={{ fontSize: 16, color: '#f5b84a' }} />);

function useInvalidate() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['links'] }), qc.invalidateQueries({ queryKey: ['admin'] }), qc.invalidateQueries({ queryKey: ['accounts'] })]);
}

/* ---------------- histórico ---------------- */
function HistoryDialog({ a, data, onClose }: { a: LinkAccount; data: LinksResponse; onClose: () => void }) {
  const { viewer } = data;
  const inv = useInvalidate();
  const [edit, setEdit] = useState<{ id: string; from: string } | null>(null);
  const [err, setErr] = useState('');
  const save = useMutation({ mutationFn: linksApi.editHistory, onSuccess: async () => { setEdit(null); setErr(''); await inv(); }, onError: (e) => setErr(msg(e)) });
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><HistoryRoundedIcon fontSize="small" /> Histórico · {a.name}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Em cada dia, a despesa da conta vai para os sites do período que vale naquele dia.{viewer.canDate ? ' Dá para corrigir a data de uma mudança (entre a anterior e a seguinte).' : ''} Para mudar os sites, edite o gestor em Usuários & Squads.
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
                  <Tooltip title="Mudar a data"><IconButton size="small" onClick={() => setEdit({ id: h.id, from: h.from })}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                ))}
              </Card>
            );
          })}
        </Stack>
        {err && <Alert severity="error" sx={{ mt: 1.5 }}>{err}</Alert>}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Fechar</Button></DialogActions>
    </Dialog>
  );
}

function LinksTab({ data }: { data: LinksResponse }) {
  const [prov, setProv] = useState<'all' | 'google-ads' | 'meta'>('all');
  const [s, setS] = useState('');
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
      {gestor && !data.accounts.length && <Alert severity="info" sx={{ mb: 1.5 }}>Nenhuma conta de anúncios vinculada a você ainda. O Admin vincula em Usuários & Squads.</Alert>}
      {gestor && !!data.accounts.length && !data.domains.length && <Alert severity="info" sx={{ mb: 1.5 }}>Nenhum domínio vinculado a você ainda. O Admin vincula em Usuários & Squads.</Alert>}
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
                        <Chip key={d.id} size="small" label={d.hostname} variant={d.editable ? 'filled' : 'outlined'} />
                      )) : <Tag tone="warn">sem site</Tag>}
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{a.since ? br(a.since) : <Typography variant="caption" color="text.secondary">sempre</Typography>}</TableCell>
                  <TableCell align="right">{a.history.filter((h) => h.from !== ALWAYS).length || '—'}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title="Histórico"><IconButton size="small" onClick={() => setHist(a)}><HistoryRoundedIcon fontSize="small" /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length && <TableRow><TableCell colSpan={5}><Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>Nenhuma conta.</Typography></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
      {hist && <HistoryDialog a={data.accounts.find((x) => x.id === hist.id) ?? hist} data={data} onClose={() => setHist(null)} />}
    </>
  );
}

export default function Links() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['links', 'list'], queryFn: linksApi.list });
  if (isLoading) return <PageSkeleton />;
  if (error || !data) return <ErrorBox error={error} retry={refetch} />;
  return (
    <Box>
      <PageHead title="Contas × Sites"
        sub="Qual site cada conta de anúncios paga e desde quando. A despesa até a data da mudança fica no site antigo; a partir dela, no novo." />
      <Alert severity="info" variant="outlined" sx={{ mb: 1.75 }}>
        Os vínculos entre usuários, domínios e contas de anúncios são feitos só em <b>Configurações → Usuários &amp; Squads</b> (editar o gestor → Domínios).
        A despesa das contas vinculadas ao gestor é a que entra no ROI dos sites dele e na comissão.
      </Alert>
      <LinksTab data={data} />
    </Box>
  );
}
