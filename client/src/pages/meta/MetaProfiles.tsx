import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Radio, Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
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
import { ConfirmDialog, copyText, ErrorBox, PageHead, PageSkeleton, Tag } from '@/components/ui/States';
import { META_REQUIRED_SCOPES, type MetaProfile, type MetaTokenCheck } from '@/types/api';
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

const APP_ID = (import.meta.env.VITE_META_APP_ID ?? '').trim();
const Code = ({ children }: { children: string }) => <Box component="code" sx={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12.5, px: 0.6, py: 0.15, borderRadius: 1, bgcolor: 'action.hover' }}>{children}</Box>;

/** Passo a passo para gerar o System User Token no Business Manager (retrátil). */
function TokenGuide({ onCopied }: { onCopied: (msg: string) => void }) {
  const copyApp = async () => onCopied(await copyText(APP_ID) ? 'ID do App copiado.' : 'Não foi possível copiar. Selecione e copie manualmente.');
  const steps: { title: string; body: React.ReactNode }[] = [
    { title: 'Abra as Configurações do Negócio', body: <>Acesse <Box component="a" href="https://business.facebook.com/settings" target="_blank" rel="noopener noreferrer" sx={{ color: 'primary.main' }}>business.facebook.com/settings <OpenInNewRoundedIcon sx={{ fontSize: 13, verticalAlign: 'text-bottom' }} /></Box>, escolha o Business Manager e vá em <b>Usuários → Usuários do sistema</b>.</> },
    { title: 'Crie (ou escolha) um Usuário do Sistema', body: <>Clique em <b>Adicionar</b>, dê um nome e escolha a função <b>Administrador</b>. Também pode usar um Usuário do Sistema que já exista.</> },
    { title: 'Atribua os ativos', body: <>Com o usuário selecionado, clique em <b>Atribuir ativos</b> e vincule, com <b>Controle total</b>: as <b>Contas de anúncios</b>, as <b>Páginas</b> e os <b>Conjuntos de dados / Pixels</b> que serão usados. Um mesmo Perfil pode ter ativos de vários BMs e várias contas.</> },
    { title: 'Gere o token', body: <>Clique em <b>Gerar novo token</b>, selecione o App do Pluto Mídia{APP_ID ? <> (ID <Code>{APP_ID}</Code>)</> : null}, defina a validade como <b>Nunca</b> (ou 60 dias) e marque <b>obrigatoriamente</b> as 5 permissões abaixo. Copie o token na hora: a Meta só o mostra uma vez.</> },
  ];
  return (
    <Accordion disableGutters variant="outlined" defaultExpanded={false} sx={{ borderRadius: 2, '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} aria-controls="token-guide" id="token-guide-h"><Typography sx={{ fontWeight: 600 }}>Como gerar o System User Token</Typography></AccordionSummary>
      <AccordionDetails id="token-guide">
        <Stack spacing={1.5}>
          {steps.map((st, i) => (
            <Stack key={i} direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
              <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: 'primary.main', color: 'primary.contrastText', fontSize: 12.5, fontWeight: 700, display: 'grid', placeItems: 'center', flexShrink: 0, mt: 0.1 }}>{i + 1}</Box>
              <Box><Typography sx={{ fontWeight: 600, fontSize: 14 }}>{st.title}</Typography><Typography variant="body2" color="text.secondary">{st.body}</Typography></Box>
            </Stack>
          ))}
          <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>{META_REQUIRED_SCOPES.map((sc) => <Chip key={sc} size="small" label={sc} sx={{ fontFamily: 'IBM Plex Mono, monospace' }} />)}</Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {APP_ID
              ? <><Typography variant="body2">ID do App do Pluto: <Code>{APP_ID}</Code></Typography><Button size="small" startIcon={<ContentCopyRoundedIcon />} onClick={copyApp}>Copiar ID</Button></>
              : <Typography variant="caption">O ID do App não está configurado neste ambiente. Peça ao administrador (META_APP_ID).</Typography>}
          </Stack>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

/** Cadastro/edição. Token novo só é salvo se a Meta confirmar as 5 permissões obrigatórias. Na edição o token é opcional. */
function ProfileDialog({ p, onClose, onSaved }: { p: MetaProfile | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [f, setF] = useState({ name: p?.name ?? '', businessId: p?.businessId ?? '', token: '' });
  const [err, setErr] = useState('');
  const [check, setCheck] = useState<MetaTokenCheck | null>(null);
  const [note, setNote] = useState('');
  const create = useAdminMutation(metaCampaignsApi.createProfile, INV);
  const save = useAdminMutation(metaCampaignsApi.updateProfile, INV);
  const verify = useAdminMutation(metaCampaignsApi.checkToken, []);
  const busy = create.isPending || save.isPending || verify.isPending;
  const token = f.token.trim();
  const setToken = (v: string) => { setF({ ...f, token: v }); setCheck(null); setErr(''); };
  const tokenFormat = () => (token.length < 20 || /\s/.test(token) ? 'Token inválido: confira se copiou inteiro e sem espaços.' : '');

  const runCheck = (then?: (c: MetaTokenCheck) => void) => {
    const bad = tokenFormat();
    if (bad) return setErr(bad);
    setErr('');
    verify.mutate(token, { onSuccess: (c) => { setCheck(c); if (c.complete) then?.(c); }, onError: (e) => setErr(errMsg(e, 'Não foi possível validar o token na Meta.')) });
  };
  const persist = () => {
    const name = f.name.trim(), biz = f.businessId.trim();
    const onError = (e: unknown) => setErr(errMsg(e, 'Não foi possível salvar.'));
    const done = () => onSaved('Perfil salvo. Token válido, com todas as permissões.');
    if (!p) return create.mutate({ name, businessId: biz || undefined, token }, { onSuccess: done, onError });
    save.mutate({ id: p.id, patch: { name, businessId: biz || null, ...(token ? { token } : {}) } }, { onSuccess: done, onError });
  };
  const submit = () => {
    const name = f.name.trim(), biz = f.businessId.trim();
    if (name.length < 2) return setErr('Digite o nome do Perfil.');
    if (biz && !/^\d{5,25}$/.test(biz)) return setErr('O ID do Business Manager tem só dígitos.');
    if (!p && !token) return setErr('Cole o System User Token.');
    if (token && tokenFormat()) return setErr(tokenFormat());
    setErr('');
    if (!token || check?.complete) return persist();
    runCheck(persist);   // confere antes de salvar; se faltar permissão, o alerta aparece e nada é salvo
  };
  const missing = check?.missing ?? [];
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{p ? 'Editar Perfil' : 'Novo Perfil / BM'}<Typography variant="caption" component="div">O token é conferido na Meta antes de salvar.</Typography></DialogTitle>
      <DialogContent><Stack spacing={1.75} sx={{ pt: 1 }}>
        <TokenGuide onCopied={setNote} />
        <TextField label="Nome do Perfil" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} fullWidth placeholder="Ex.: BM Contingência 01" />
        <TextField label="ID do Business Manager (opcional)" value={f.businessId} onChange={(e) => setF({ ...f, businessId: e.target.value })} fullWidth placeholder="Só dígitos"
          helperText="BM principal, usado para listar Datasets e Páginas do Business. As contas de anúncios e Páginas de outros BMs atribuídas ao mesmo Usuário do Sistema aparecem normalmente." />
        <TextField label={p ? 'Novo System User Token (opcional)' : 'System User Token'} type="password" autoComplete="off" value={f.token} onChange={(e) => setToken(e.target.value)} fullWidth
          placeholder={p ? `Atual: ••••${p.tokenLast4}` : 'EAAB…'} helperText="Cole o token gerado no passo 4. Ele é criptografado e não pode ser lido de volta." />
        {!!token && (
          <Box><Button size="small" variant="outlined" onClick={() => runCheck()} disabled={busy} startIcon={verify.isPending ? <CircularProgress size={14} /> : <VerifiedUserOutlinedIcon />}>Validar token</Button></Box>
        )}
        {check && !check.valid && <Alert severity="error" variant="outlined">{check.message ?? 'A Meta recusou o token.'}</Alert>}
        {check?.valid && missing.length > 0 && (
          <Alert severity="error" variant="outlined">
            <Typography sx={{ fontWeight: 600, fontSize: 14 }}>Faltam permissões neste token. O Perfil não será salvo.</Typography>
            <Typography variant="body2">Gere o token de novo (passo 4) e marque {missing.length > 1 ? 'estas caixas' : 'esta caixa'}:</Typography>
            <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', mt: 0.75 }}>{missing.map((m) => <Chip key={m} size="small" color="error" label={m} sx={{ fontFamily: 'IBM Plex Mono, monospace' }} />)}</Stack>
          </Alert>
        )}
        {check?.complete && (
          <Alert severity="success" variant="outlined">
            Token válido{check.systemUserName ? ` (${check.systemUserName})` : ''} com as {META_REQUIRED_SCOPES.length} permissões obrigatórias.
            {check.expiresAt ? ` Expira em ${new Date(check.expiresAt).toLocaleDateString('pt-BR')}.` : ' Não expira.'}
          </Alert>
        )}
        {err && <Alert severity="error" variant="outlined">{err}</Alert>}
      </Stack></DialogContent>
      <DialogActions><Button onClick={onClose} disabled={busy}>Cancelar</Button><Button variant="contained" onClick={submit} disabled={busy || (!!token && !!check && !check.complete)} startIcon={busy ? <CircularProgress size={16} /> : undefined}>{busy ? 'Validando…' : 'Salvar'}</Button></DialogActions>
      <Snackbar open={!!note} autoHideDuration={2500} onClose={() => setNote('')} message={note} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
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
