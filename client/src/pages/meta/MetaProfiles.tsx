import { Alert, AlertTitle, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Grid, Radio, Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography } from '@mui/material';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import FacebookRoundedIcon from '@mui/icons-material/FacebookRounded';
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LockResetRoundedIcon from '@mui/icons-material/LockResetRounded';
import SyncRoundedIcon from '@mui/icons-material/SyncRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import { useEffect, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { useAdminMutation, useMetaAdAccounts, useMetaPages, useMetaProfiles } from '@/hooks/queries';
import { metaCampaignsApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';
import { relTime } from '@/lib/format';
import { ConfirmDialog, ErrorBox, PageHead, PageSkeleton, Tag } from '@/components/ui/States';
import type { MetaProfile } from '@/types/api';
import { daysLeft, getDefaultPage, profileLabel, profileTone, RENEW_WARN_DAYS, setDefaultPage } from './shared';

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const INV = [qk.metaProfiles];
const mono = { fontFamily: 'IBM Plex Mono, monospace' } as const;

/** Resultado do Facebook Login devolvido pelo servidor na URL (?meta_oauth=…). Nunca traz token. */
interface OAuthResult { severity: 'success' | 'warning' | 'error'; title: string; body?: string }
function readOAuthResult(sp: URLSearchParams): OAuthResult | null {
  const st = sp.get('meta_oauth');
  if (!st) return null;
  const name = sp.get('name') ?? 'Perfil';
  if (st === 'error') return { severity: 'error', title: 'Não foi possível conectar o Perfil do Facebook.', body: sp.get('message') ?? undefined };
  if (st === 'missing_scopes') return { severity: 'warning', title: `${name} foi conectado, mas faltam permissões.`, body: `Permissões não concedidas: ${(sp.get('missing') ?? '').split(',').join(', ')}. Clique em "Reconectar / Renovar" e marque todas na janela da Meta.` };
  const notes = [
    sp.get('other') === '1' ? 'O navegador estava logado em outro Perfil do Facebook, então ele foi conectado como um Perfil separado.' : '',
    sp.get('sync') === 'failed' ? 'A sincronização inicial dos ativos falhou: use "Sincronizar Ativos".' : '',
    sp.get('warnings') ? 'Alguns ativos não puderam ser lidos (veja o aviso no card do Perfil).' : '',
  ].filter(Boolean);
  return { severity: notes.length ? 'warning' : 'success', title: sp.get('created') === '1' ? `Perfil ${name} conectado e ativos sincronizados.` : `Perfil ${name} renovado: token válido por mais 60 dias.`, body: notes.join(' ') || undefined };
}

/* =====================================================================
   Perfis & BMs (0.18.2): cada gestor conecta um ou mais Perfis do Facebook (contingência) pelo Facebook Login.
   O servidor troca a autorização por um token de longa duração (~60 dias), criptografa e nunca o devolve ao navegador.
   ===================================================================== */
export default function MetaProfilesPage() {
  const { data, error, refetch } = useMetaProfiles();
  const [sp, setSp] = useSearchParams();
  const [result, setResult] = useState<OAuthResult | null>(() => readOAuthResult(sp));
  const [assets, setAssets] = useState<MetaProfile | null>(null);
  const [del, setDel] = useState<MetaProfile | null>(null);
  const [toast, setToast] = useState('');
  const [connecting, setConnecting] = useState<string | null>(null);   // 'new' ou id do Perfil sendo renovado
  const remove = useAdminMutation(metaCampaignsApi.deleteProfile, INV);
  const sync = useAdminMutation(metaCampaignsApi.syncProfile, INV);

  // limpa os parâmetros do retorno do OAuth (o resultado fica no estado)
  useEffect(() => { if (sp.has('meta_oauth')) setSp({}, { replace: true }); }, [sp, setSp]);

  /** Abre o diálogo de login da Meta (navegação na mesma aba; o callback volta para esta tela). */
  const connect = async (profile?: MetaProfile) => {
    setConnecting(profile?.id ?? 'new');
    try {
      const { url } = await metaCampaignsApi.oauthUrl(profile ? { mode: 'reauthenticate', profileId: profile.id } : { mode: 'rerequest' });
      window.location.assign(url);
    } catch (e) {
      setConnecting(null);
      setToast(errMsg(e, 'Não foi possível iniciar a conexão com o Facebook.'));
    }
  };
  const runSync = (p: MetaProfile) => sync.mutate(p.id, {
    onSuccess: (r) => setToast(r.sync.warnings.length ? `Ativos sincronizados com ${r.sync.warnings.length} aviso(s).` : `Ativos de ${p.name} sincronizados.`),
    onError: (e) => { setToast(errMsg(e, 'Falha ao sincronizar.')); void refetch(); },
  });

  if (error) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  const connectBtn = (
    <Button variant="contained" startIcon={connecting === 'new' ? <CircularProgress size={16} color="inherit" /> : <FacebookRoundedIcon />} disabled={!!connecting} onClick={() => connect()}>
      Conectar Perfil do Facebook
    </Button>
  );
  return (
    <>
      <PageHead title="Perfis & BMs" sub="Conecte seus Perfis do Facebook (contingência) e sincronize os BMs, contas de anúncios, Páginas e Pixels de cada um."
        right={<><Button variant="outlined" component={RouterLink} to="/criar-campanha-meta" startIcon={<AutoAwesomeOutlinedIcon />}>Criar campanhas</Button>{connectBtn}</>} />

      {result && <Alert severity={result.severity} variant="outlined" sx={{ mb: 2 }} onClose={() => setResult(null)}><AlertTitle>{result.title}</AlertTitle>{result.body}</Alert>}

      <Alert severity="info" variant="outlined" icon={<InfoOutlinedIcon />} sx={{ mb: 2 }}>
        <b>Vários Perfis de contingência:</b> o botão conecta o Perfil do Facebook que estiver logado neste navegador. Para conectar um segundo Perfil,
        entre nele no Facebook (ou abra o Pluto numa janela anônima e faça login lá com o outro Perfil) e clique em <b>Conectar Perfil do Facebook</b> de novo.
        O token é criptografado no servidor e vale por cerca de 60 dias; renove antes de vencer.
      </Alert>

      {!data.profiles.length ? (
        <Card><CardContent sx={{ textAlign: 'center', py: 4.5 }}>
          <Typography variant="h2">Nenhum Perfil conectado</Typography>
          <Typography color="text.secondary" sx={{ my: 1.5 }}>Conecte ao menos um Perfil do Facebook para criar campanhas. Vamos pedir as permissões de anúncios, Business Manager e Páginas.</Typography>
          {connectBtn}
        </CardContent></Card>
      ) : (
        <Grid container spacing={2}>
          {data.profiles.map((p) => (
            <Grid key={p.id} size={{ xs: 12, lg: 6 }}>
              <ProfileCard p={p} syncing={sync.isPending && sync.variables === p.id} renewing={connecting === p.id} disabled={!!connecting}
                onSync={() => runSync(p)} onRenew={() => connect(p)} onRemove={() => setDel(p)} onAssets={() => setAssets(p)} />
            </Grid>
          ))}
        </Grid>
      )}

      {assets && <AssetsDialog p={assets} onClose={() => setAssets(null)} />}
      <ConfirmDialog open={!!del} title="Remover Perfil?" confirmLabel="Remover" busy={remove.isPending} onClose={() => { setDel(null); remove.reset(); }}
        onConfirm={() => del && remove.mutate(del.id, { onSuccess: () => { setToast(`Perfil ${del.name} removido.`); setDel(null); } })}>
        O Perfil <b>{del?.name}</b>, o token salvo e os ativos sincronizados serão apagados do Pluto. As campanhas já criadas na Meta não são afetadas.
        Para revogar o acesso também na Meta, remova o App em Configurações do Facebook → Integrações comerciais.
        {remove.error && <Alert severity="error" variant="outlined" sx={{ mt: 1.5 }}>{errMsg(remove.error, 'Não foi possível remover.')}</Alert>}
      </ConfirmDialog>
      <Snackbar open={!!toast} autoHideDuration={4500} onClose={() => setToast('')} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </>
  );
}

/** Situação do token: status + dias restantes. */
function TokenStatus({ p }: { p: MetaProfile }) {
  const d = daysLeft(p);
  const expired = p.status === 'expired' || (d !== null && d < 0);
  const label = expired ? 'Token vencido' : p.status !== 'valid' ? profileLabel(p.status) : 'Ativo';
  const tone = expired ? 'neg' : p.status !== 'valid' ? profileTone(p.status) : d !== null && d <= RENEW_WARN_DAYS ? 'warn' : 'pos';
  const when = p.tokenExpiresAt ? new Date(p.tokenExpiresAt).toLocaleDateString('pt-BR') : null;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
      <Tag tone={tone}>{label}</Tag>
      <Typography variant="body2" color="text.secondary">
        {expired ? `Venceu em ${when}` : d === null ? 'Não expira' : d === 0 ? `Vence hoje (${when})` : `${d} ${d === 1 ? 'dia restante' : 'dias restantes'} · vence em ${when}`}
      </Typography>
    </Stack>
  );
}

function Count({ n, label }: { n: number; label: string }) {
  return (
    <Box sx={{ px: 1.25, py: 0.75, borderRadius: 1.5, bgcolor: 'action.hover', minWidth: 0 }}>
      <Typography sx={{ fontWeight: 700, fontSize: 18, lineHeight: 1.2 }}>{n}</Typography>
      <Typography variant="caption" color="text.secondary" noWrap>{label}</Typography>
    </Box>
  );
}

function ProfileCard({ p, syncing, renewing, disabled, onSync, onRenew, onRemove, onAssets }: {
  p: MetaProfile; syncing: boolean; renewing: boolean; disabled: boolean; onSync: () => void; onRenew: () => void; onRemove: () => void; onAssets: () => void;
}) {
  const d = daysLeft(p);
  const legacy = p.source === 'system_user';
  const needsRenew = !legacy && (p.status !== 'valid' || (d !== null && d <= RENEW_WARN_DAYS));
  return (
    <Card sx={{ height: '100%' }}><CardContent>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
          <FacebookRoundedIcon sx={{ color: legacy ? 'text.disabled' : '#1877F2', fontSize: 34, mt: 0.25 }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography sx={{ fontWeight: 700, fontSize: 16 }} noWrap>{p.name}</Typography>
              {legacy && <Chip size="small" label="Token manual (legado)" />}
            </Stack>
            <Typography variant="caption" component="div" sx={mono}>ID {p.fbUserId ?? p.businessId ?? '—'}{p.email ? <Box component="span" sx={{ fontFamily: 'inherit', ml: 1, color: 'text.secondary' }}>{p.email}</Box> : null}</Typography>
          </Box>
        </Stack>

        <TokenStatus p={p} />
        {p.status !== 'valid' && p.message && <Alert severity="error" variant="outlined" sx={{ py: 0 }}>{p.message}</Alert>}
        {legacy && <Typography variant="caption">Perfil cadastrado com System User Token. Para migrar, conecte o Perfil do Facebook e remova este.</Typography>}

        <Grid container spacing={1}>
          <Grid size={{ xs: 6, sm: 3 }}><Count n={p.counts.businesses} label="BMs" /></Grid>
          <Grid size={{ xs: 6, sm: 3 }}><Count n={p.counts.adAccounts} label="Contas de anúncios" /></Grid>
          <Grid size={{ xs: 6, sm: 3 }}><Count n={p.counts.pages} label="Páginas" /></Grid>
          <Grid size={{ xs: 6, sm: 3 }}><Count n={p.counts.datasets} label="Pixels/Datasets" /></Grid>
        </Grid>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Typography variant="caption">{p.lastSyncedAt ? `Sincronizado ${relTime(p.lastSyncedAt)}` : 'Ainda não sincronizado'}</Typography>
          {p.syncError && <Tooltip title={p.syncError}><WarningAmberRoundedIcon color="warning" sx={{ fontSize: 16 }} aria-label="Avisos da sincronização" /></Tooltip>}
        </Stack>

        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {needsRenew && (
            <Button size="small" variant="contained" color={p.status === 'valid' ? 'warning' : 'error'} disabled={disabled}
              startIcon={renewing ? <CircularProgress size={14} color="inherit" /> : <LockResetRoundedIcon />} onClick={onRenew}>Reconectar / Renovar</Button>
          )}
          <Button size="small" variant="outlined" disabled={syncing || p.status === 'expired'} startIcon={syncing ? <CircularProgress size={14} /> : <SyncRoundedIcon />} onClick={onSync}>
            {syncing ? 'Sincronizando…' : 'Sincronizar Ativos'}
          </Button>
          <Button size="small" startIcon={<FlagOutlinedIcon />} onClick={onAssets}>Páginas e contas</Button>
          <Box sx={{ flex: 1 }} />
          <Button size="small" color="error" startIcon={<DeleteOutlineRoundedIcon />} onClick={onRemove}>Remover Perfil</Button>
        </Stack>
      </Stack>
    </CardContent></Card>
  );
}

/** Páginas (marcar a padrão do Wizard) e contas de anúncios liberadas para o gestor, a partir dos ativos sincronizados. */
function AssetsDialog({ p, onClose }: { p: MetaProfile; onClose: () => void }) {
  const pages = useMetaPages(p.id);
  const accounts = useMetaAdAccounts(p.id);
  const [def, setDef] = useState(() => getDefaultPage(p.id));
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{p.name}<Typography variant="caption" component="div">Ativos sincronizados {p.lastSyncedAt ? relTime(p.lastSyncedAt) : '—'}. Use "Sincronizar Ativos" para atualizar.</Typography></DialogTitle>
      <DialogContent>
        <Typography variant="overline" component="div" sx={{ mb: 1 }}>Páginas</Typography>
        {pages.error ? <ErrorBox error={pages.error} retry={() => pages.refetch()} /> : !pages.data ? <PageSkeleton /> : !pages.data.pages.length ? <Alert severity="warning" variant="outlined">Nenhuma Página sincronizada neste Perfil.</Alert> : (
          <TableContainer component={Card} variant="outlined"><Table size="small">
            <TableHead><TableRow><TableCell>Padrão</TableCell><TableCell>Página</TableCell><TableCell>ID</TableCell><TableCell>Categoria</TableCell></TableRow></TableHead>
            <TableBody>{pages.data.pages.map((pg) => (
              <TableRow key={pg.id} hover>
                <TableCell padding="checkbox"><Radio size="small" checked={def === pg.id} onChange={() => { setDef(pg.id); setDefaultPage(p.id, pg.id); }} slotProps={{ input: { 'aria-label': `Usar ${pg.name} como padrão` } }} /></TableCell>
                <TableCell>{pg.name}</TableCell><TableCell sx={mono}>{pg.id}</TableCell><TableCell>{pg.category ?? '—'}</TableCell>
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
              {!accounts.data.adAccounts.length && <Typography variant="caption">Nenhuma conta deste Perfil foi atribuída a você pelo Admin.</Typography>}
            </Stack>
            {accounts.data.hiddenCount > 0 && <Typography variant="caption" component="p" sx={{ mt: 0.75 }}>{accounts.data.hiddenCount} conta(s) do Perfil não aparecem porque não foram atribuídas a você.</Typography>}
          </>
        )}
      </DialogContent>
      <DialogActions><Box sx={{ flex: 1 }} /><Button variant="contained" onClick={onClose}>Fechar</Button></DialogActions>
    </Dialog>
  );
}
