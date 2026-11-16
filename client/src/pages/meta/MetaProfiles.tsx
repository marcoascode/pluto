import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Radio, Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAdminMutation, useMetaAdAccounts, useMetaPages, useMetaProfiles } from '@/hooks/queries';
import { metaCampaignsApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';
import { relTime } from '@/lib/format';
import { ConfirmDialog, ErrorBox, PageHead, PageSkeleton, Tag } from '@/components/ui/States';
import type { MetaProfile } from '@/types/api';
import { getDefaultPage, profileLabel, profileTone, setDefaultPage } from './shared';

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const INV = [qk.metaProfiles];

/* =====================================================================
   Perfis & BMs (0.18): cada gestor cadastra os próprios Perfis/BMs com o System User Token.
   O token é criptografado no servidor e nunca volta para o navegador (só os 4 últimos caracteres).
   ===================================================================== */
export default function MetaProfilesPage() {
  const { data, error, refetch } = useMetaProfiles();
  const [form, setForm] = useState<MetaProfile | 'new' | null>(null);
  const [assets, setAssets] = useState<MetaProfile | null>(null);
  const [del, setDel] = useState<MetaProfile | null>(null);
  const [toast, setToast] = useState('');
  const remove = useAdminMutation(metaCampaignsApi.deleteProfile, INV);
  const validate = useAdminMutation(metaCampaignsApi.validateProfile, INV);
  if (error) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  return (
    <>
      <PageHead title="Perfis & BMs" sub="Cadastre o Perfil/BM, o System User Token e sincronize as Páginas que ele enxerga."
        right={<><Button variant="outlined" component={RouterLink} to="/criar-campanha-meta" startIcon={<AutoAwesomeOutlinedIcon />}>Criar campanhas</Button><Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setForm('new')}>Novo Perfil</Button></>} />
      <Alert severity="info" variant="outlined" icon={<VerifiedUserOutlinedIcon />} sx={{ mb: 2 }}>
        O System User Token é criptografado no servidor e não pode ser lido de volta depois de salvo. Para trocar, edite o Perfil e informe um novo token.
      </Alert>
      {!data.profiles.length ? (
        <Card><CardContent sx={{ textAlign: 'center', py: 4.5 }}>
          <Typography variant="h2">Nenhum Perfil cadastrado</Typography>
          <Typography color="text.secondary" sx={{ my: 1.5 }}>Cadastre ao menos um Perfil/BM com o System User Token para criar campanhas.</Typography>
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setForm('new')}>Novo Perfil</Button>
        </CardContent></Card>
      ) : (
        <TableContainer component={Card}><Table>
          <TableHead><TableRow>{['Perfil', 'Business Manager', 'System User', 'Token', 'Status', 'Validado', ''].map((h) => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>{data.profiles.map((p) => (
            <TableRow key={p.id}>
              <TableCell>{p.name}</TableCell>
              <TableCell>{p.businessId ?? <Typography variant="caption">Não informado</Typography>}</TableCell>
              <TableCell>{p.systemUserName ?? '—'}</TableCell>
              <TableCell sx={{ fontFamily: 'IBM Plex Mono, monospace' }}>••••{p.tokenLast4}</TableCell>
              <TableCell sx={{ whiteSpace: 'normal', maxWidth: 280 }}>
                <Tooltip title={p.message ?? ''}><span><Tag tone={profileTone(p.status)}>{profileLabel(p.status)}</Tag></span></Tooltip>
                {p.status === 'invalid' && p.message && <Typography variant="caption" component="div" sx={{ color: 'error.main', mt: 0.5 }}>{p.message}</Typography>}
              </TableCell>
              <TableCell>{relTime(p.lastValidatedAt)}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                <Tooltip title="Páginas e contas"><span><IconButton size="small" aria-label={`Páginas de ${p.name}`} disabled={p.status === 'invalid'} onClick={() => setAssets(p)}><FlagOutlinedIcon fontSize="small" /></IconButton></span></Tooltip>{' '}
                <Tooltip title="Revalidar token"><span><IconButton size="small" aria-label={`Revalidar ${p.name}`} disabled={validate.isPending}
                  onClick={() => validate.mutate(p.id, { onSuccess: (r) => setToast(r.status === 'valid' ? 'Token válido.' : 'A Meta recusou o token.'), onError: (e) => setToast(errMsg(e, 'Falha ao revalidar.')) })}><RefreshRoundedIcon fontSize="small" /></IconButton></span></Tooltip>{' '}
                <Tooltip title="Editar"><IconButton size="small" aria-label={`Editar ${p.name}`} onClick={() => setForm(p)}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>{' '}
                <Tooltip title="Excluir"><IconButton size="small" aria-label={`Excluir ${p.name}`} onClick={() => setDel(p)}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip>
              </TableCell>
            </TableRow>
          ))}</TableBody>
        </Table></TableContainer>
      )}
      {form && <ProfileDialog key={form === 'new' ? 'new' : form.id} p={form === 'new' ? null : form} onClose={() => setForm(null)} onSaved={(m) => { setForm(null); setToast(m); }} />}
      {assets && <AssetsDialog p={assets} onClose={() => setAssets(null)} />}
      <ConfirmDialog open={!!del} title="Excluir Perfil?" busy={remove.isPending} onClose={() => { setDel(null); remove.reset(); }} onConfirm={() => del && remove.mutate(del.id, { onSuccess: () => setDel(null) })}>
        O Perfil <b>{del?.name}</b> e o token salvo serão apagados. As campanhas já criadas na Meta não são afetadas.
        {remove.error && <Alert severity="error" variant="outlined" sx={{ mt: 1.5 }}>{errMsg(remove.error, 'Não foi possível excluir.')}</Alert>}
      </ConfirmDialog>
      <Snackbar open={!!toast} autoHideDuration={4000} onClose={() => setToast('')} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </>
  );
}

/** Cadastro/edição. Na edição o token é opcional (em branco = mantém o atual). */
function ProfileDialog({ p, onClose, onSaved }: { p: MetaProfile | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [f, setF] = useState({ name: p?.name ?? '', businessId: p?.businessId ?? '', token: '' });
  const [err, setErr] = useState('');
  const create = useAdminMutation(metaCampaignsApi.createProfile, INV);
  const save = useAdminMutation(metaCampaignsApi.updateProfile, INV);
  const busy = create.isPending || save.isPending;
  const submit = () => {
    const name = f.name.trim(), biz = f.businessId.trim(), token = f.token.trim();
    if (name.length < 2) return setErr('Digite o nome do Perfil.');
    if (biz && !/^\d{5,25}$/.test(biz)) return setErr('O ID do Business Manager tem só dígitos.');
    if (!p && !token) return setErr('Cole o System User Token.');
    if (token && (token.length < 20 || /\s/.test(token))) return setErr('Token inválido: confira se copiou inteiro e sem espaços.');
    setErr('');
    const onError = (e: unknown) => setErr(errMsg(e, 'Não foi possível salvar.'));
    const done = (r: MetaProfile) => onSaved(r.status === 'valid' ? 'Perfil salvo. Token válido.' : `Perfil salvo, mas a Meta recusou o token${r.message ? `: ${r.message}` : '.'}`);
    if (!p) return create.mutate({ name, businessId: biz || undefined, token }, { onSuccess: done, onError });
    save.mutate({ id: p.id, patch: { name, businessId: biz || null, ...(token ? { token } : {}) } }, { onSuccess: done, onError });
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{p ? 'Editar Perfil' : 'Novo Perfil / BM'}<Typography variant="caption" component="div">O token é validado na Meta ao salvar.</Typography></DialogTitle>
      <DialogContent><Stack spacing={1.75} sx={{ pt: 1 }}>
        <TextField label="Nome do Perfil" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} fullWidth placeholder="Ex.: BM Contingência 01" />
        <TextField label="ID do Business Manager" value={f.businessId} onChange={(e) => setF({ ...f, businessId: e.target.value })} fullWidth placeholder="Só dígitos" helperText="Necessário para listar Datasets do BM e as Páginas do Business. Opcional." />
        <TextField label={p ? 'Novo System User Token (opcional)' : 'System User Token'} type="password" autoComplete="off" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} fullWidth
          placeholder={p ? `Atual: ••••${p.tokenLast4}` : 'EAAB…'} helperText="Permissões: ads_management, ads_read, business_management e pages_show_list." />
        {err && <Alert severity="error" variant="outlined">{err}</Alert>}
      </Stack></DialogContent>
      <DialogActions><Button onClick={onClose} disabled={busy}>Cancelar</Button><Button variant="contained" onClick={submit} disabled={busy} startIcon={busy ? <CircularProgress size={16} /> : undefined}>{busy ? 'Validando…' : 'Salvar'}</Button></DialogActions>
    </Dialog>
  );
}

/** Páginas (sincronizar e marcar a padrão) e contas de anúncios liberadas para o gestor, lidas ao vivo na Meta. */
function AssetsDialog({ p, onClose }: { p: MetaProfile; onClose: () => void }) {
  const qc = useQueryClient();
  const pages = useMetaPages(p.id);
  const accounts = useMetaAdAccounts(p.id);
  const [def, setDef] = useState(() => getDefaultPage(p.id));
  const sync = () => { void qc.invalidateQueries({ queryKey: qk.metaPages(p.id) }); void qc.invalidateQueries({ queryKey: qk.metaAdAccounts(p.id) }); };
  const busy = pages.isFetching || accounts.isFetching;
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{p.name}<Typography variant="caption" component="div">Páginas e contas de anúncios acessíveis por este token</Typography></DialogTitle>
      <DialogContent>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="overline">Páginas</Typography>
          <Button size="small" startIcon={busy ? <CircularProgress size={14} /> : <RefreshRoundedIcon />} onClick={sync} disabled={busy}>Sincronizar</Button>
        </Stack>
        {pages.error ? <ErrorBox error={pages.error} retry={() => pages.refetch()} /> : !pages.data ? <PageSkeleton /> : !pages.data.pages.length ? <Alert severity="warning" variant="outlined">Nenhuma Página encontrada para este token.</Alert> : (
          <TableContainer component={Card} variant="outlined"><Table size="small">
            <TableHead><TableRow><TableCell>Padrão</TableCell><TableCell>Página</TableCell><TableCell>ID</TableCell><TableCell>Categoria</TableCell></TableRow></TableHead>
            <TableBody>{pages.data.pages.map((pg) => (
              <TableRow key={pg.id} hover>
                <TableCell padding="checkbox"><Radio size="small" checked={def === pg.id} onChange={() => { setDef(pg.id); setDefaultPage(p.id, pg.id); }} slotProps={{ input: { 'aria-label': `Usar ${pg.name} como padrão` } }} /></TableCell>
                <TableCell>{pg.name}</TableCell><TableCell sx={{ fontFamily: 'IBM Plex Mono, monospace' }}>{pg.id}</TableCell><TableCell>{pg.category ?? '—'}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table></TableContainer>
        )}
        <Typography variant="caption" component="p" sx={{ mt: 0.75 }}>A Página padrão vem pré-selecionada no assistente de campanhas (guardada só neste navegador).</Typography>

        <Typography variant="overline" component="div" sx={{ mt: 2.5, mb: 1 }}>Contas de anúncios liberadas para você</Typography>
        {accounts.error ? <ErrorBox error={accounts.error} retry={() => accounts.refetch()} /> : !accounts.data ? <PageSkeleton /> : (
          <>
            <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {accounts.data.adAccounts.map((a) => <Chip key={a.id} size="small" label={`${a.name} · ${a.currency ?? '—'}${a.sites.length ? ` · ${a.sites.join(', ')}` : ' · sem site'}`} />)}
              {!accounts.data.adAccounts.length && <Typography variant="caption">Nenhuma conta deste token foi atribuída a você pelo Admin.</Typography>}
            </Stack>
            {accounts.data.hiddenCount > 0 && <Typography variant="caption" component="p" sx={{ mt: 0.75 }}>{accounts.data.hiddenCount} conta(s) do token não aparecem porque não foram atribuídas a você.</Typography>}
          </>
        )}
      </DialogContent>
      <DialogActions><Box sx={{ flex: 1 }} /><Button variant="contained" onClick={onClose}>Fechar</Button></DialogActions>
    </Dialog>
  );
}
