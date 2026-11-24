/**
 * 0.18.9 · "Gestores e sites" na edição do gestor (Usuários & Squads).
 * Períodos com datas e rateio de quem responde por um site para a comissão. Nos dias que um período cobre, ele vale
 * por cima do Rateio do domínio (Admin → Domínios). Trocou o responsável? Coloque a data de fim e crie outro período:
 * os meses anteriores não mudam. Só Admin/SuperAdmin editam (o servidor confere).
 */
import {
  Alert, Autocomplete, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, MenuItem, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography, useTheme,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useFinanceMutation } from '@/hooks/queries';
import { ApiError } from '@/lib/api/client';
import { PageSkeleton } from '@/components/ui/States';
import { ddmmyyyy } from '@/lib/finance';
import { commissionsApi, parseNum, pctFmt, type Assignment, type AssignmentsResponse } from '@/lib/financeOps';
import { todayISO } from '@/lib/period';

const NOW = todayISO().slice(0, 7);

export function GestorPeriodsDialog({ userId, userName, onClose }: { userId: string; userName: string; onClose: () => void }) {
  const { pluto: p } = useTheme();
  const { data, error } = useQuery({ queryKey: ['finance', 'assignments', userId], queryFn: () => commissionsApi.assignments({ user: userId }) });
  const [edit, setEdit] = useState<Assignment | 'new' | null>(null);
  const [err, setErr] = useState('');
  const remove = useFinanceMutation(commissionsApi.removeAssignment);
  const co = new Map((data?.companies ?? []).map((c) => [c.id, c.name]));
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Gestores e sites · {userName}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Por quais sites {userName.split(' ')[0]} responde na comissão, desde quando e com qual parte (rateio). Nos dias que um período cobre, ele vale no lugar
          do Rateio do domínio. Trocou o responsável? Coloque a data de fim e crie outro período: os meses anteriores não mudam.
        </Typography>
        {error ? <Alert severity="error" variant="outlined">{error instanceof ApiError ? error.message : 'Não foi possível carregar.'}</Alert>
          : !data ? <PageSkeleton /> : edit ? <PeriodForm data={data} userId={userId} initial={edit === 'new' ? null : edit} onDone={() => setEdit(null)} /> : (<>
          <TableContainer><Table size="small" sx={{ '& td, & th': { whiteSpace: 'nowrap' } }}>
            <TableHead><TableRow><TableCell>Site</TableCell>{data.companies.length > 1 && <TableCell>Empresa</TableCell>}<TableCell>Período</TableCell><TableCell align="right">Rateio</TableCell><TableCell>Observação</TableCell><TableCell /></TableRow></TableHead>
            <TableBody>
              {data.assignments.map((a) => (
                <TableRow key={a.id} sx={{ opacity: a.endDate && a.endDate < todayISO() ? 0.55 : 1 }}>
                  <TableCell><b>{a.site}</b></TableCell>{data.companies.length > 1 && <TableCell>{co.get(a.companyId)}</TableCell>}
                  <TableCell>{ddmmyyyy(a.startDate)} → {a.endDate ? ddmmyyyy(a.endDate) : 'atual'}</TableCell>
                  <TableCell align="right">{pctFmt(a.sharePct, 3)}</TableCell>
                  <TableCell sx={{ whiteSpace: 'normal !important', maxWidth: 220 }}>{a.note ?? '—'}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => setEdit(a)} aria-label={`Editar ${a.site}`}><EditOutlinedIcon fontSize="small" /></IconButton>
                    <IconButton size="small" onClick={() => remove.mutate(a.id, { onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível excluir.') })} aria-label={`Excluir ${a.site}`}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {!data.assignments.length && <TableRow><TableCell colSpan={6} sx={{ color: 'text.disabled', py: 3 }} align="center">Nenhum período. A comissão usa os domínios do gestor e o Rateio de cada domínio.</TableCell></TableRow>}
            </TableBody>
          </Table></TableContainer>
          {err && <Alert severity="error" variant="outlined" sx={{ mt: 1.5 }} onClose={() => setErr('')}>{err}</Alert>}
          <Button startIcon={<AddRoundedIcon />} onClick={() => setEdit('new')} sx={{ mt: 1.5, color: p.accent }}>Adicionar período</Button>
        </>)}
      </DialogContent>
      <DialogActions><Button variant="outlined" onClick={onClose}>Fechar</Button></DialogActions>
    </Dialog>
  );
}

function PeriodForm({ data, userId, initial, onDone }: { data: AssignmentsResponse; userId: string; initial: Assignment | null; onDone: () => void }) {
  const [f, setF] = useState({
    companyId: initial?.companyId ?? data.companies[0]?.id ?? '', site: initial?.site ?? '', startDate: initial?.startDate ?? `${NOW}-01`,
    endDate: initial?.endDate ?? '', sharePct: String(initial?.sharePct ?? 100).replace('.', ','), note: initial?.note ?? '',
  });
  const [err, setErr] = useState('');
  const save = useFinanceMutation(commissionsApi.saveAssignment);
  const submit = () => {
    const share = parseNum(f.sharePct);
    if (!f.site.trim()) return setErr('Escolha o site.');
    if (!Number.isFinite(share) || share <= 0 || share > 100) return setErr('O rateio precisa ser maior que 0 e até 100%.');
    if (f.endDate && f.endDate < f.startDate) return setErr('O fim não pode ser antes do início.');
    setErr('');
    save.mutate({ id: initial?.id, userId, companyId: f.companyId, site: f.site.trim(), startDate: f.startDate, endDate: f.endDate || null, sharePct: share, note: f.note.trim() || null },
      { onSuccess: onDone, onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.') });
  };
  return (
    <Stack spacing={1.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
        {data.companies.length > 1 && <TextField select size="small" label="Empresa" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })} sx={{ flex: 1 }}>{data.companies.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</TextField>}
        <Autocomplete freeSolo size="small" sx={{ flex: 1.3 }} options={data.sites.filter((s) => s.companyId === f.companyId).map((s) => s.site)} value={f.site} onInputChange={(_, v) => setF({ ...f, site: v })} renderInput={(pr) => <TextField {...pr} label="Site" placeholder="dominiox.com" />} />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
        <TextField size="small" type="date" label="Responsável desde" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} sx={{ flex: 1 }} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField size="small" type="date" label="Até (opcional)" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} sx={{ flex: 1 }} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField size="small" label="Rateio" value={f.sharePct} onChange={(e) => setF({ ...f, sharePct: e.target.value })} sx={{ width: { sm: 130 } }} helperText="100% = só ele"
          slotProps={{ htmlInput: { inputMode: 'decimal' }, input: { endAdornment: <InputAdornment position="end">%</InputAdornment> } }} />
      </Stack>
      <TextField size="small" label="Observação" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      <Typography variant="caption">No mesmo período, a soma do rateio do site entre os gestores não pode passar de 100%.</Typography>
      {err && <Alert severity="error" variant="outlined">{err}</Alert>}
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}><Button onClick={onDone}>Voltar</Button><Button variant="contained" onClick={submit} disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar período'}</Button></Stack>
    </Stack>
  );
}
