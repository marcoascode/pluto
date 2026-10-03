import { Alert, Box, Button, Card, CardHeader, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, ListItemText, MenuItem, Select, Snackbar, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useState } from 'react';
import { useAdminDomains, useAdminMutation, useIntegrationAccounts, useSyncSettings } from '@/hooks/queries';
import { integrationsApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';
import { ConfirmDialog, ErrorBox, PageSkeleton, StatusChip } from '@/components/ui/States';
import { relTime } from '@/lib/format';
import type { Currency, IntegrationAccount, IntegrationAccountInput, Provider } from '@/types/api';

export type { Provider };

/** Pede ao servidor a URL do OAuth e leva o navegador para o login do Google/Meta. */
export function useConnect() {
  const [msg, setMsg] = useState('');
  const connect = async (p: Provider) => {
    try {
      const { authorizeUrl } = await integrationsApi.startOAuth(p);
      if (authorizeUrl.startsWith('#')) setMsg('Modo mock: no servidor real, aqui abre o login do Google/Meta.');
      else window.location.href = authorizeUrl;
    } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Não foi possível iniciar a conexão.'); }
  };
  const snack = <Snackbar open={!!msg} autoHideDuration={3500} onClose={() => setMsg('')} message={msg} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />;
  return { connect, snack };
}

/* ------------------------------------------------------------------ */
/* Contas (CRUD)                                                        */
/* ------------------------------------------------------------------ */
const ID_INFO: Record<Provider, { label: string; placeholder: string; pattern: RegExp; hint: string }> = {
  'google-ads': { label: 'Customer ID', placeholder: '123-456-7890', pattern: /^\d{3}-?\d{3}-?\d{4}$/, hint: '10 dígitos, com ou sem traços' },
  meta: { label: 'Ad Account ID', placeholder: 'act_1234567890', pattern: /^(act_)?\d{5,20}$/, hint: 'act_ seguido dos números' },
  gam: { label: 'Network code', placeholder: '12345678', pattern: /^\d{3,12}$/, hint: 'Só números (Admin → Global settings no Ad Manager)' },
};
const TIMEZONES = ['America/Sao_Paulo', 'America/New_York', 'America/Los_Angeles', 'America/Mexico_City', 'Europe/Lisbon', 'Europe/Madrid', 'UTC'];
const EMPTY: IntegrationAccountInput = { name: '', externalId: '', currency: 'USD', timezone: 'America/Sao_Paulo', imported: true, domains: [] };

function AccountDialog({ provider, initial, onClose }: { provider: Provider; initial: IntegrationAccount | null | 'new'; onClose: () => void }) {
  const isNew = initial === 'new';
  const [f, setF] = useState<IntegrationAccountInput>(initial && initial !== 'new' ? { name: initial.name, externalId: initial.externalId, currency: initial.currency, timezone: initial.timezone, imported: initial.imported, domains: initial.domains } : EMPTY);
  const [err, setErr] = useState('');
  const { data: doms } = useAdminDomains();
  const inv = [qk.accounts(provider), qk.integrations, qk.adminDomains];
  const create = useAdminMutation((b: IntegrationAccountInput) => integrationsApi.createAccount(provider, b), inv);
  const update = useAdminMutation((b: IntegrationAccountInput) => integrationsApi.updateAccount(provider, (initial as IntegrationAccount).id, b), inv);
  const info = ID_INFO[provider];
  const save = () => {
    if (!f.name.trim()) return setErr('Digite o nome da conta.');
    if (!info.pattern.test(f.externalId.trim())) return setErr(`${info.label} inválido: ${info.hint}.`);
    setErr('');
    const body = { ...f, name: f.name.trim(), externalId: f.externalId.trim() };
    (isNew ? create : update).mutate(body, { onSuccess: onClose, onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.') });
  };
  const busy = create.isPending || update.isPending;
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isNew ? 'Adicionar conta' : 'Editar conta'}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.75} sx={{ pt: 1 }}>
          <TextField label="Nome" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} fullWidth autoFocus />
          <TextField label={info.label} placeholder={info.placeholder} helperText={info.hint} value={f.externalId} onChange={(e) => setF({ ...f, externalId: e.target.value })} fullWidth disabled={!isNew} />
          <Stack direction="row" spacing={1.5}>
            <TextField select label="Moeda da conta" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })} sx={{ flex: 1 }}>{(['USD', 'BRL', 'EUR'] as Currency[]).map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}</TextField>
            <TextField select label="Timezone" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} sx={{ flex: 2 }}>{TIMEZONES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}</TextField>
          </Stack>
          {provider !== 'gam' && (
            <TextField select label="Domínios desta conta" value={f.domains} onChange={(e) => setF({ ...f, domains: typeof e.target.value === 'string' ? e.target.value.split(',') : (e.target.value as string[]) })} fullWidth
              slotProps={{ select: { multiple: true, renderValue: (v) => (v as string[]).join(', ') || 'Nenhum' } }} helperText="O custo desta conta entra nesses domínios.">
              {doms?.domains.map((d) => <MenuItem key={d.hostname} value={d.hostname}><Checkbox size="small" checked={f.domains.includes(d.hostname)} /><ListItemText primary={d.hostname} /></MenuItem>)}
            </TextField>
          )}
          <FormControlLabel control={<Switch checked={f.imported} onChange={(e) => setF({ ...f, imported: e.target.checked })} />} label="Importar no sync" />
          {err && <Alert severity="error" variant="outlined">{err}</Alert>}
          {isNew && <Typography variant="caption">Normalmente as contas chegam sozinhas pelo OAuth. Adicionar à mão só funciona se a conta conectada tiver acesso a ela.</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions><Button variant="outlined" onClick={onClose}>Cancelar</Button><Button variant="contained" onClick={save} disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</Button></DialogActions>
    </Dialog>
  );
}

/** Tabela de contas de uma integração, com importar/editar/excluir/adicionar. */
export function AccountsCard({ provider, title }: { provider: Provider; title: string }) {
  const { data, error, refetch } = useIntegrationAccounts(provider);
  const [edit, setEdit] = useState<IntegrationAccount | 'new' | null>(null);
  const [del, setDel] = useState<IntegrationAccount | null>(null);
  const inv = [qk.accounts(provider), qk.integrations, qk.adminDomains];
  const toggle = useAdminMutation(({ id, imported }: { id: string; imported: boolean }) => integrationsApi.updateAccount(provider, id, { imported }), inv);
  const remove = useAdminMutation((id: string) => integrationsApi.deleteAccount(provider, id), inv);
  if (error) return <Box sx={{ mt: 1.75 }}><ErrorBox error={error} retry={() => refetch()} /></Box>;
  if (!data) return <Box sx={{ mt: 1.75 }}><PageSkeleton /></Box>;
  const acc = data.accounts;
  return (
    <Card sx={{ mt: 1.75 }}>
      <CardHeader title={title} subheader={`${acc.filter((a) => a.imported).length} de ${acc.length} importadas`} action={<Button size="small" variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setEdit('new')}>Adicionar conta</Button>} />
      <TableContainer><Table>
        <TableHead><TableRow>{['Importar', 'Conta', ID_INFO[provider].label, 'Moeda', 'Timezone', ...(provider !== 'gam' ? ['Domínios'] : []), 'Status', 'Último sync', 'Aviso', ''].map((h) => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead>
        <TableBody>
          {acc.map((a) => (
            <TableRow key={a.id}>
              <TableCell padding="checkbox"><Checkbox size="small" checked={a.imported} onChange={(e) => toggle.mutate({ id: a.id, imported: e.target.checked })} slotProps={{ input: { 'aria-label': `Importar ${a.name}` } }} /></TableCell>
              <TableCell><b>{a.name}</b></TableCell>
              <TableCell sx={{ fontFamily: 'IBM Plex Mono' }}>{a.externalId}</TableCell>
              <TableCell>{a.currency}</TableCell><TableCell>{a.timezone}</TableCell>
              {provider !== 'gam' && <TableCell sx={{ whiteSpace: 'normal', minWidth: 140 }}>{a.domains.length ? <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>{a.domains.map((d) => <Chip key={d} size="small" label={d} />)}</Stack> : '—'}</TableCell>}
              <TableCell><StatusChip status={a.status} /></TableCell>
              <TableCell>{relTime(a.lastSyncAt)}</TableCell>
              <TableCell sx={{ whiteSpace: 'normal', color: 'text.disabled', fontSize: 12, minWidth: 160 }}>{a.message}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                <Tooltip title="Editar"><IconButton size="small" onClick={() => setEdit(a)} aria-label={`Editar ${a.name}`}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>{' '}
                <Tooltip title="Excluir"><IconButton size="small" onClick={() => setDel(a)} aria-label={`Excluir ${a.name}`}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip>
              </TableCell>
            </TableRow>
          ))}
          {!acc.length && <TableRow><TableCell colSpan={10} align="center" sx={{ py: 4, color: 'text.disabled' }}>Nenhuma conta. Conecte via OAuth ou adicione uma conta.</TableCell></TableRow>}
        </TableBody>
      </Table></TableContainer>
      {edit && <AccountDialog key={edit === 'new' ? 'new' : edit.id} provider={provider} initial={edit} onClose={() => setEdit(null)} />}
      <ConfirmDialog open={!!del} title="Excluir conta?" busy={remove.isPending} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id, { onSuccess: () => setDel(null) })}>
        A conta <b>{del?.name}</b> deixa de ser sincronizada e sai dos domínios. Os dados já importados ficam no histórico.
      </ConfirmDialog>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Sincronização (frequência por job)                                   */
/* ------------------------------------------------------------------ */
const FREQ: [number, string][] = [[15, 'a cada 15 min'], [30, 'a cada 30 min'], [60, 'a cada 1 h'], [120, 'a cada 2 h'], [360, 'a cada 6 h'], [720, 'a cada 12 h'], [1440, '1× ao dia']];
const fmtWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

export function SyncPanel({ provider }: { provider: Provider | 'fx' }) {
  const { data } = useSyncSettings();
  const [msg, setMsg] = useState('');
  const upd = useAdminMutation(({ id, ...b }: { id: string; everyMinutes?: number; enabled?: boolean }) => integrationsApi.updateSyncSetting(id, b), [qk.syncSettings]);
  const rows = data?.settings.filter((s) => s.provider === provider) ?? [];
  const syncNow = async () => {
    if (provider === 'fx') return;
    try { await integrationsApi.syncNow(provider); setMsg('Sincronização colocada na fila.'); } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Não foi possível enfileirar.'); }
  };
  return (
    <Card sx={{ mt: 1.75 }}>
      <CardHeader title="Sincronização" subheader="Fila com retry e backoff exponencial. Só a janela incremental é baixada de novo."
        action={provider !== 'fx' ? <Button size="small" variant="outlined" onClick={syncNow}>Sincronizar agora</Button> : undefined} />
      <TableContainer><Table size="small">
        <TableHead><TableRow>{['Job', 'Janela', 'Frequência', 'Ativo', 'Última execução', 'Próxima'].map((h) => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead>
        <TableBody>{rows.map((j) => (
          <TableRow key={j.id}>
            <TableCell>{j.label}</TableCell>
            <TableCell sx={{ color: 'text.secondary' }}>{j.window}</TableCell>
            <TableCell><Select size="small" value={j.everyMinutes} onChange={(e) => upd.mutate({ id: j.id, everyMinutes: Number(e.target.value) })} inputProps={{ 'aria-label': `Frequência de ${j.label}` }}>
              {(FREQ.some(([v]) => v === j.everyMinutes) ? FREQ : [...FREQ, [j.everyMinutes, `a cada ${j.everyMinutes} min`] as [number, string]]).map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
            </Select></TableCell>
            <TableCell><Switch size="small" checked={j.enabled} onChange={(e) => upd.mutate({ id: j.id, enabled: e.target.checked })} slotProps={{ input: { 'aria-label': `Ativar ${j.label}` } }} /></TableCell>
            <TableCell>{fmtWhen(j.lastRunAt)}{j.lastStatus === 'failed' && <Chip size="small" color="error" label="falhou" sx={{ ml: 0.75, height: 18 }} />}</TableCell>
            <TableCell>{j.enabled ? fmtWhen(j.nextRunAt) : 'pausado'}</TableCell>
          </TableRow>
        ))}
          {!rows.length && <TableRow><TableCell colSpan={6} sx={{ color: 'text.disabled' }}>Carregando…</TableCell></TableRow>}
        </TableBody>
      </Table></TableContainer>
      <Snackbar open={!!msg} autoHideDuration={3000} onClose={() => setMsg('')} message={msg} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Card>
  );
}
