import { Alert, Button, Card, CardHeader, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, IconButton, ListItemText, MenuItem, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useState } from 'react';
import { useAdminDomains, useAdminMutation, useIntegrationAccounts, useSquads } from '@/hooks/queries';
import { adminApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';
import { ConfirmDialog, ErrorBox, PageHead, PageSkeleton, Tag } from '@/components/ui/States';
import { relTime } from '@/lib/format';
import { todayISO } from '@/lib/period';
import type { Domain, DomainInput } from '@/types/api';

const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const clean = (v: string) => v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
const INV = [qk.adminDomains, qk.myDomains, qk.squads, qk.accounts('google-ads'), qk.accounts('meta')];

function DomainDialog({ d, onClose }: { d: Domain; onClose: () => void }) {
  const { data: sq } = useSquads();
  const { data: ga } = useIntegrationAccounts('google-ads');
  const { data: ma } = useIntegrationAccounts('meta');
  const today = todayISO();   // data no fuso da organização (não UTC)
  const [f, setF] = useState<Omit<Required<DomainInput>, 'revShare' | 'revShareFrom'>>({ hostname: d.hostname, active: d.active, squadId: d.squadId, googleAccounts: d.googleAccounts, metaAccounts: d.metaAccounts });
  const [rs, setRs] = useState(String(d.revShare ?? 0).replace('.', ','));
  const [rsFrom, setRsFrom] = useState(today);
  const [err, setErr] = useState('');
  const save = useAdminMutation((b: DomainInput) => adminApi.updateDomain(d.hostname, b), INV);
  const multi = (label: string, key: 'googleAccounts' | 'metaAccounts', opts: { id: string; name: string }[]) => (
    <TextField select label={label} value={f[key]} fullWidth onChange={(e) => setF({ ...f, [key]: typeof e.target.value === 'string' ? e.target.value.split(',') : (e.target.value as string[]) })}
      slotProps={{ select: { multiple: true, renderValue: (v) => (v as string[]).map((id) => opts.find((o) => o.id === id)?.name ?? id).join(', ') || 'Nenhuma' } }}>
      {opts.map((o) => <MenuItem key={o.id} value={o.id}><Checkbox size="small" checked={f[key].includes(o.id)} /><ListItemText primary={o.name} /></MenuItem>)}
    </TextField>
  );
  const submit = () => {
    const h = clean(f.hostname);
    if (!HOST_RE.test(h)) return setErr('Digite um domínio válido, ex.: novodominio.com');
    const share = Number(rs.replace(',', '.'));
    if (!Number.isFinite(share) || share < 0 || share >= 100) return setErr('revShare precisa ser um percentual entre 0 e 99,999.');
    setErr('');
    const changed = Math.abs(share - (d.revShare ?? 0)) > 1e-9;
    save.mutate({ ...f, hostname: h, ...(changed ? { revShare: share, revShareFrom: rsFrom } : {}) }, { onSuccess: onClose, onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.') });
  };
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Editar domínio</DialogTitle>
      <DialogContent><Stack spacing={1.75} sx={{ pt: 1 }}>
        <TextField label="Domínio" value={f.hostname} onChange={(e) => setF({ ...f, hostname: e.target.value })} fullWidth helperText="Renomear mantém o histórico de dados." />
        <Stack direction="row" spacing={1.5}>
          <TextField label="revShare da Network (%)" value={rs} onChange={(e) => setRs(e.target.value)} sx={{ flex: 1 }} slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            helperText={`Hoje: ${String(d.revShare ?? 0).replace('.', ',')}%${d.revShareFrom && d.revShareFrom > '2000-01-01' ? ` desde ${d.revShareFrom.split('-').reverse().join('/')}` : ''}`} />
          <TextField label="Vale a partir de" type="date" value={rsFrom} onChange={(e) => setRsFrom(e.target.value)} sx={{ flex: 1 }} slotProps={{ inputLabel: { shrink: true } }}
            helperText="Dias anteriores mantêm o percentual antigo" />
        </Stack>
        <Typography variant="caption" sx={{ mt: -0.75 }}>Parte da receita do Ad Manager que a Network (ex.: Publeno) retém. A receita exibida já vem descontada; o revShare não aparece nos relatórios.</Typography>
        <TextField select label="Squad" value={f.squadId ?? ''} onChange={(e) => setF({ ...f, squadId: e.target.value || null })} fullWidth>
          <MenuItem value="">Sem Squad (só Admin e SuperAdmin veem)</MenuItem>
          {sq?.squads.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
        </TextField>
        {multi('Contas Google Ads', 'googleAccounts', (ga?.accounts ?? []).map((a) => ({ id: a.id, name: `${a.name} · ${a.externalId}` })))}
        {multi('Contas Meta Ads', 'metaAccounts', (ma?.accounts ?? []).map((a) => ({ id: a.id, name: `${a.name} · ${a.externalId}` })))}
        <FormControlLabel control={<Switch checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />} label="Ativo" />
        {err && <Alert severity="error" variant="outlined">{err}</Alert>}
      </Stack></DialogContent>
      <DialogActions><Button variant="outlined" onClick={onClose}>Cancelar</Button><Button variant="contained" onClick={submit} disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button></DialogActions>
    </Dialog>
  );
}

export default function AdminDomainsPage() {
  const { data, error, refetch } = useAdminDomains();
  const { data: sq } = useSquads();
  const { data: ga } = useIntegrationAccounts('google-ads');
  const { data: ma } = useIntegrationAccounts('meta');
  const [host, setHost] = useState(''); const [msg, setMsg] = useState('');
  const [edit, setEdit] = useState<Domain | null>(null);
  const [del, setDel] = useState<Domain | null>(null);
  const create = useAdminMutation(adminApi.createDomain, INV);
  const toggle = useAdminMutation(({ h, active }: { h: string; active: boolean }) => adminApi.updateDomain(h, { active }), INV);
  const remove = useAdminMutation(adminApi.deleteDomain, INV);
  if (error) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  const d = data.domains; const act = d.filter((x) => x.active).length; const noSq = d.filter((x) => x.active && !x.squadId).length;
  const accName = (id: string) => [...(ga?.accounts ?? []), ...(ma?.accounts ?? [])].find((a) => a.id === id)?.name ?? id;
  const add = () => {
    const v = clean(host);
    if (!HOST_RE.test(v)) return setMsg('Digite um domínio válido, ex.: novodominio.com');
    setMsg(''); create.mutate(v, { onSuccess: () => setHost(''), onError: (e) => setMsg(e instanceof ApiError ? e.message : 'Não foi possível adicionar.') });
  };
  return (
    <>
      <PageHead title="Domínios" sub="Cadastro dos sites, Squad e contas de tráfego de cada um." />
      <Grid container spacing={1.75} sx={{ mb: 1.75 }}>
        {([['Total de domínios', d.length], ['Ativos', act], ['Inativos', d.length - act], ['Domínios sem Squad', noSq]] as const).map(([l, v]) => (
          <Grid key={l} size={{ xs: 6, md: 3 }}><Card sx={{ p: 2.25 }}><Typography variant="caption">{l}</Typography><Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: 28, color: l === 'Domínios sem Squad' && v > 0 ? 'warning.main' : undefined }}>{v}</Typography></Card></Grid>
        ))}
      </Grid>
      <Card>
        <CardHeader title="Domínios" action={<Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}><TextField size="small" placeholder="novodominio.com" value={host} onChange={(e) => setHost(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} error={!!msg} helperText={msg || undefined} /><Button variant="contained" size="small" onClick={add} disabled={create.isPending}>Adicionar domínio</Button></Stack>} />
        <TableContainer><Table>
          <TableHead><TableRow>{['Domínio', 'Squad', 'Google Ads', 'Meta Ads', 'revShare', 'Status', 'Último dado recebido', ''].map((h) => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>{d.map((x) => (
            <TableRow key={x.hostname}>
              <TableCell><b>{x.hostname}</b>{x.createdBySync && <Typography variant="caption" component="div" sx={{ color: 'warning.main' }}>Visto no Ad Manager · ative para cadastrar</Typography>}</TableCell>
              <TableCell>{sq?.squads.find((s) => s.id === x.squadId)?.name ?? <Tag tone="warn">Sem Squad</Tag>}</TableCell>
              <TableCell sx={{ whiteSpace: 'normal' }}>{x.googleAccounts.map(accName).join(', ') || '—'}</TableCell>
              <TableCell sx={{ whiteSpace: 'normal' }}>{x.metaAccounts.map(accName).join(', ') || '—'}</TableCell>
              <TableCell>{String(x.revShare ?? 0).replace('.', ',')}%</TableCell>
              <TableCell>{x.active ? <Tag tone="pos">Ativo</Tag> : <Tag>Inativo</Tag>}</TableCell><TableCell>{relTime(x.lastDataAt)}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                <Button size="small" variant="outlined" onClick={() => toggle.mutate({ h: x.hostname, active: !x.active })}>{x.active ? 'Desativar' : 'Ativar'}</Button>{' '}
                <Tooltip title="Editar"><IconButton size="small" onClick={() => setEdit(x)} aria-label={`Editar ${x.hostname}`}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>{' '}
                <Tooltip title="Excluir"><IconButton size="small" onClick={() => setDel(x)} aria-label={`Excluir ${x.hostname}`}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip>
              </TableCell>
            </TableRow>
          ))}</TableBody>
        </Table></TableContainer>
      </Card>
      {edit && <DomainDialog key={edit.hostname} d={edit} onClose={() => setEdit(null)} />}
      <ConfirmDialog open={!!del} title="Excluir domínio?" busy={remove.isPending} onClose={() => { setDel(null); remove.reset(); }} onConfirm={() => del && remove.mutate(del.hostname, { onSuccess: () => setDel(null) })}>
        <b>{del?.hostname}</b> sai dos Squads e das contas. Para só esconder sem apagar, use <b>Desativar</b>. Domínios com dados históricos não podem ser excluídos.
        {remove.error && <Alert severity="error" variant="outlined" sx={{ mt: 1.5 }}>{remove.error instanceof ApiError ? remove.error.message : 'Não foi possível excluir.'}</Alert>}
      </ConfirmDialog>
    </>
  );
}
