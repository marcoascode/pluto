import { Alert, Box, Button, Card, CardHeader, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, ListItemText, MenuItem, Select, Snackbar, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import PowerOutlinedIcon from '@mui/icons-material/PowerOutlined';
import type { ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useState } from 'react';
import { useAdminDomains, useAdminMutation, useIntegrationAccounts, useSyncSettings } from '@/hooks/queries';
import { integrationsApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';
import { ConfirmDialog, ErrorBox, PageSkeleton, StatusChip } from '@/components/ui/States';
import { relTime } from '@/lib/format';
import type { Currency, IntegrationAccount, IntegrationAccountInput, Provider, SyncSetting } from '@/types/api';

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

/** Botão "Conectar": só SuperAdmin conecta integrações (o servidor também bloqueia). */
export function ConnectButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  const { can } = useAuth();
  const ok = can('admin.integrations.connect');
  return (
    <Tooltip title={ok ? '' : 'Só o SuperAdmin conecta integrações'}>
      <span><Button variant="contained" startIcon={<PowerOutlinedIcon />} onClick={onClick} disabled={!ok}>{children}</Button></span>
    </Tooltip>
  );
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
const FREQ: [number, string][] = [[15, 'a cada 15 min'], [30, 'a cada 30 min'], [60, 'a cada 1 h'], [120, 'a cada 2 h'], [360, 'a cada 6 h'], [720, 'a cada 12 h'], [1440, '1× ao dia'], [10080, '1× por semana']];
const fmtWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
type SyncPatch = { id: string; everyMinutes?: number; enabled?: boolean; windowMode?: 'days' | 'incremental'; windowDays?: number; retentionDays?: number | null };

/** Janela editável: "D-X → hoje" (fechamento do Ad Manager: "D-X → D-4") ou "incremental". */
function WindowCell({ j, locked, onSave }: { j: SyncSetting; locked: boolean; onSave: (b: Omit<SyncPatch, 'id'>) => void }) {
  const [x, setX] = useState(String(j.windowDays ?? 3));
  const close = j.id === 'gam.close';
  if (!j.windowEditable || locked) return <Typography variant="body2" sx={{ color: 'text.secondary' }}>{j.window}</Typography>;
  const commit = () => { const n = Math.round(Number(x)); const min = close ? 4 : 0; if (!Number.isFinite(n) || n < min || n > 90) { setX(String(j.windowDays ?? 3)); return; } if (n !== j.windowDays) onSave({ windowMode: 'days', windowDays: n }); };
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
      {!close && (
        <Select size="small" value={j.windowMode} onChange={(e) => onSave(e.target.value === 'incremental' ? { windowMode: 'incremental' } : { windowMode: 'days', windowDays: j.windowDays ?? 3 })} inputProps={{ 'aria-label': `Janela de ${j.label}` }}>
          <MenuItem value="days">Últimos dias</MenuItem><MenuItem value="incremental">Incremental</MenuItem>
        </Select>
      )}
      {j.windowMode === 'days' && (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Typography variant="body2">D-</Typography>
          <TextField size="small" value={x} onChange={(e) => setX(e.target.value.replace(/\D/g, '').slice(0, 2))} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()}
            sx={{ width: 58 }} slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': `Dias da janela de ${j.label}` } }} />
          <Typography variant="body2" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{close ? '→ D-4' : '→ hoje'}</Typography>
        </Stack>
      )}
      {j.windowMode === 'incremental' && <Tooltip title="Do dia da última execução com sucesso (com 1 dia de folga) até hoje. Na primeira importação volta 30 dias."><Typography variant="caption">desde a última execução</Typography></Tooltip>}
    </Stack>
  );
}

/** "Exclua dados com mais de X dias": limpeza de grupos/conjuntos e anúncios antigos (jobs *.cleanup). */
function RetentionBox({ j, locked, onSave }: { j: SyncSetting; locked: boolean; onSave: (days: number | null) => void }) {
  const [x, setX] = useState(j.retentionDays ? String(j.retentionDays) : '');
  const [confirm, setConfirm] = useState<number | null | undefined>(undefined);
  const n = x ? Math.round(Number(x)) : null;
  const valid = n === null || (Number.isFinite(n) && n >= 7 && n <= 3650);
  const changed = n !== (j.retentionDays ?? null);
  const lvl = j.provider === 'meta' ? 'conjuntos' : 'grupos';
  return (
    <Box sx={{ px: 2, py: 1.75, borderTop: 1, borderColor: 'divider' }}>
      <Typography sx={{ fontWeight: 600, fontSize: 13.5 }}>Limpeza de dados antigos</Typography>
      <Typography variant="caption" component="div" sx={{ mb: 1 }}>
        Remove do banco os {lvl} e anúncios que não aparecem mais na plataforma (pausados há muito tempo, removidos ou arquivados) e sem métrica no período.
        As métricas antigas deles não somem: são somadas na campanha. Roda {FREQ.find(([v]) => v === j.everyMinutes)?.[1] ?? `a cada ${j.everyMinutes} min`}.
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2">Exclua dados com mais de</Typography>
        <TextField size="small" value={x} disabled={locked} placeholder="—" onChange={(e) => setX(e.target.value.replace(/\D/g, '').slice(0, 4))} error={!valid}
          sx={{ width: 84 }} slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': 'Dias para manter' } }} />
        <Typography variant="body2">dias</Typography>
        {!locked && <Button size="small" variant="contained" disabled={!valid || !changed} onClick={() => setConfirm(n)}>Salvar</Button>}
        {!locked && j.retentionDays && <Button size="small" onClick={() => { setX(''); setConfirm(null); }}>Desligar</Button>}
        <Typography variant="caption">{j.retentionDays ? `Ligada: ${j.retentionDays} dias` : 'Desligada'}{locked ? ' · definida pelo SuperAdmin' : ' · mínimo 7 dias'}</Typography>
      </Stack>
      <ConfirmDialog open={confirm !== undefined} title={confirm ? `Excluir ${lvl} e anúncios com mais de ${confirm} dias?` : 'Desligar a limpeza?'} confirmLabel={confirm ? 'Salvar e ligar' : 'Desligar'} danger={!!confirm}
        onClose={() => setConfirm(undefined)} onConfirm={() => { onSave(confirm ?? null); setConfirm(undefined); }}>
        {confirm ? <>Na próxima execução, os {lvl} e anúncios sem atividade há mais de <b>{confirm} dias</b> saem do banco. Os totais por dia, campanha e domínio continuam iguais, mas o detalhe por {lvl === 'grupos' ? 'grupo' : 'conjunto'}/anúncio desses itens deixa de existir.</> : 'Nada mais será excluído automaticamente.'}
      </ConfirmDialog>
    </Box>
  );
}

export function SyncPanel({ provider }: { provider: Provider | 'fx' }) {
  const { data } = useSyncSettings();
  const { can } = useAuth();
  const locked = !can('admin.integrations.connect');   // frequência, janela, liga/desliga e limpeza: só SuperAdmin
  const [msg, setMsg] = useState('');
  const upd = useAdminMutation(({ id, ...b }: SyncPatch) => integrationsApi.updateSyncSetting(id, b), [qk.syncSettings]);
  const save = (id: string) => (b: Omit<SyncPatch, 'id'>) => upd.mutate({ id, ...b }, { onError: (e) => setMsg(e instanceof ApiError ? e.message : 'Não foi possível salvar.') });
  const all = data?.settings.filter((s) => s.provider === provider) ?? [];
  const rows = all.filter((s) => !s.hasRetention);
  const cleanup = all.find((s) => s.hasRetention);
  const syncNow = async () => {
    if (provider === 'fx') return;
    try { await integrationsApi.syncNow(provider); setMsg('Sincronização colocada na fila.'); } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Não foi possível enfileirar.'); }
  };
  return (
    <Card sx={{ mt: 1.75 }}>
      <CardHeader title="Sincronização" subheader={locked ? 'Frequência e janela definidas pelo SuperAdmin. Um erro numa conta não interrompe as outras.' : 'Janela: quantos dias para trás cada execução baixa de novo (D-X → hoje) ou incremental. Um erro numa conta não interrompe as outras.'}
        action={provider !== 'fx' ? <Button size="small" variant="outlined" onClick={syncNow}>Sincronizar agora</Button> : undefined} />
      <TableContainer><Table size="small">
        <TableHead><TableRow>{['Job', 'Janela', 'Frequência', 'Ativo', 'Última execução', 'Próxima'].map((h) => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead>
        <TableBody>{rows.map((j) => (
          <TableRow key={j.id}>
            <TableCell>{j.label}</TableCell>
            <TableCell><WindowCell key={`${j.windowMode}-${j.windowDays}`} j={j} locked={locked} onSave={save(j.id)} /></TableCell>
            <TableCell><Select size="small" disabled={locked} value={j.everyMinutes} onChange={(e) => save(j.id)({ everyMinutes: Number(e.target.value) })} inputProps={{ 'aria-label': `Frequência de ${j.label}` }}>
              {(FREQ.some(([v]) => v === j.everyMinutes) ? FREQ : [...FREQ, [j.everyMinutes, `a cada ${j.everyMinutes} min`] as [number, string]]).map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
            </Select></TableCell>
            <TableCell><Switch size="small" disabled={locked} checked={j.enabled} onChange={(e) => save(j.id)({ enabled: e.target.checked })} slotProps={{ input: { 'aria-label': `Ativar ${j.label}` } }} /></TableCell>
            <TableCell>
              <Tooltip title={j.lastMessage ?? ''}><span>{fmtWhen(j.lastRunAt)}</span></Tooltip>
              {j.lastStatus === 'failed' && <Tooltip title={j.lastMessage ?? ''}><Chip size="small" color="error" label="falhou" sx={{ ml: 0.75, height: 18 }} /></Tooltip>}
            </TableCell>
            <TableCell>{j.enabled ? fmtWhen(j.nextRunAt) : 'pausado'}</TableCell>
          </TableRow>
        ))}
          {!rows.length && <TableRow><TableCell colSpan={6} sx={{ color: 'text.disabled' }}>Carregando…</TableCell></TableRow>}
        </TableBody>
      </Table></TableContainer>
      {cleanup && <RetentionBox key={String(cleanup.retentionDays)} j={cleanup} locked={locked} onSave={(days) => save(cleanup.id)({ retentionDays: days })} />}
      <Snackbar open={!!msg} autoHideDuration={3000} onClose={() => setMsg('')} message={msg} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Card>
  );
}
