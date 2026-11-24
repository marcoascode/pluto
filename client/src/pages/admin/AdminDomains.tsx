import { Alert, Button, Card, CardHeader, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, Grid, IconButton, InputAdornment, MenuItem, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
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
const INV = [qk.adminDomains, qk.myDomainsAll, qk.squads, qk.accounts('google-ads'), qk.accounts('meta'), ['links']];
const br = (iso?: string | null) => (iso ? iso.split('-').reverse().join('/') : '');
/** dias até o vencimento do registro (negativo = vencido) */
const daysTo = (iso: string) => Math.round((Date.parse(`${iso}T12:00:00`) - Date.parse(`${todayISO()}T12:00:00`)) / 864e5);
export function ExpiryTag({ iso }: { iso?: string | null }) {
  if (!iso) return <Typography variant="caption">—</Typography>;
  const n = daysTo(iso);
  return n < 0 ? <Tag tone="neg">Vencido em {br(iso)}</Tag> : n <= 30 ? <Tag tone="warn">{br(iso)} · {n} dia{n === 1 ? '' : 's'}</Tag> : <Typography sx={{ fontSize: 13 }}>{br(iso)}</Typography>;
}

function DomainDialog({ d, onClose }: { d: Domain; onClose: () => void }) {
  const { data: sq } = useSquads();
  const { data: ga } = useIntegrationAccounts('google-ads');
  const { data: ma } = useIntegrationAccounts('meta');
  const { data: gam } = useIntegrationAccounts('gam');
  const today = todayISO();   // data no fuso da organização (não UTC)
  const [f, setF] = useState<Pick<Required<DomainInput>, 'hostname' | 'active' | 'squadId' | 'gamAccountId'>>({ hostname: d.hostname, active: d.active, squadId: d.squadId, gamAccountId: d.gamAccountId });
  const [rs, setRs] = useState(String(d.revShare ?? 0).replace('.', ','));
  const [rsFrom, setRsFrom] = useState(today);
  const [err, setErr] = useState('');
  // 0.17: registro do domínio
  const [reg, setReg] = useState({ registrar: d.registrar ?? '', expiresOn: d.expiresOn ?? '', hosting: d.hosting ?? '', wpUser: d.wpUser ?? '' });
  const [pw, setPw] = useState('');                 // senha nova (vazio = mantém)
  const [shown, setShown] = useState<string | null>(null);
  const [clearPw, setClearPw] = useState(false);
  const [pwErr, setPwErr] = useState('');
  // 0.18.9: rateio da receita entre os gestores do domínio (só com 2+ gestores; soma = 100%)
  const multiMgr = d.managers.length > 1;
  const hasShares = multiMgr && d.managers.every((m) => m.sharePct != null);
  const [shares, setShares] = useState<Record<string, string>>(() => Object.fromEntries(d.managers.map((m) => [m.userId, m.sharePct != null ? String(m.sharePct).replace('.', ',') : String(Math.round((100 / Math.max(1, d.managers.length)) * 1000) / 1000).replace('.', ',')])));
  const [useShares, setUseShares] = useState(hasShares);
  const shareNum = (id: string) => Number((shares[id] ?? '').trim().replace(',', '.'));
  const shareSum = Math.round(d.managers.reduce((a, m) => a + (Number.isFinite(shareNum(m.userId)) ? shareNum(m.userId) : 0), 0) * 1000) / 1000;
  const sharesChanged = useShares !== hasShares || (useShares && d.managers.some((m) => Math.abs(shareNum(m.userId) - (m.sharePct ?? -1)) > 1e-9));
  const reveal = async () => {
    setPwErr('');
    try { const r = await adminApi.revealWpPassword(d.hostname); setShown(r.password); } catch (e) { setPwErr(e instanceof ApiError ? e.message : 'Não foi possível abrir a senha.'); }
  };
  const save = useAdminMutation((b: DomainInput) => adminApi.updateDomain(d.hostname, b), INV);
  const submit = () => {
    const h = clean(f.hostname);
    if (!HOST_RE.test(h)) return setErr('Digite um domínio válido, ex.: novodominio.com');
    const share = Number(rs.replace(',', '.'));
    if (!Number.isFinite(share) || share < 0 || share >= 100) return setErr('revShare precisa ser um percentual entre 0 e 99,999.');
    setErr('');
    const changed = Math.abs(share - (d.revShare ?? 0)) > 1e-9;
    if (multiMgr && useShares && sharesChanged) {
      if (d.managers.some((m) => !Number.isFinite(shareNum(m.userId)) || shareNum(m.userId) <= 0 || shareNum(m.userId) > 100)) return setErr('Rateio: cada gestor precisa ter uma porcentagem maior que 0 e até 100%.');
      if (Math.abs(shareSum - 100) > 0.001) return setErr(`Rateio: a soma das porcentagens precisa ser 100% (está em ${String(shareSum).replace('.', ',')}%).`);
    }
    const n = (v: string) => v.trim() || null;
    save.mutate({
      ...(multiMgr && sharesChanged ? { managerShares: useShares ? d.managers.map((m) => ({ userId: m.userId, sharePct: shareNum(m.userId) })) : null } : {}),
      ...f, hostname: h, ...(changed ? { revShare: share, revShareFrom: rsFrom } : {}),
      registrar: n(reg.registrar), expiresOn: reg.expiresOn || null, hosting: n(reg.hosting), wpUser: n(reg.wpUser),
      ...(clearPw ? { wpPassword: null } : pw ? { wpPassword: pw } : {}),
    }, { onSuccess: onClose, onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.') });
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
          <MenuItem value="">Sem Squad (gestores do domínio, Admin e SuperAdmin veem)</MenuItem>
          {sq?.squads.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
        </TextField>
        <TextField select label="Conta do Google Ad Manager" value={f.gamAccountId ?? ''} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }} onChange={(e) => setF({ ...f, gamAccountId: e.target.value || null })} fullWidth
          helperText="Cada domínio fica em uma conta do Ad Manager. Sem escolher, o sync liga o domínio à primeira rede que mostrar o site.">
          <MenuItem value="">Automático (primeira rede que mostrar o site)</MenuItem>
          {gam?.accounts.map((a) => <MenuItem key={a.id} value={a.id}>{a.name} · {a.externalId}</MenuItem>)}
        </TextField>
        <Divider />
        <Typography variant="overline" sx={{ mb: -1 }}>Registro do domínio</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField label="Registro" placeholder="ex.: Registro.br, GoDaddy, Hostinger" value={reg.registrar} onChange={(e) => setReg({ ...reg, registrar: e.target.value })} sx={{ flex: 1.4 }} helperText="Onde o domínio foi comprado" />
          <TextField label="Vencimento" type="date" value={reg.expiresOn} onChange={(e) => setReg({ ...reg, expiresOn: e.target.value })} sx={{ flex: 1 }} slotProps={{ inputLabel: { shrink: true } }} helperText="Quando o registro vence" />
        </Stack>
        <TextField label="Hospedagem" placeholder="ex.: Hostinger VPS 2 · IP 0.0.0.0" value={reg.hosting} onChange={(e) => setReg({ ...reg, hosting: e.target.value })} fullWidth helperText="Em qual servidor o site está" />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField label="Usuário WP" value={reg.wpUser} onChange={(e) => setReg({ ...reg, wpUser: e.target.value })} sx={{ flex: 1 }} autoComplete="off" slotProps={{ htmlInput: { autoComplete: 'off', 'data-lpignore': 'true' } }} />
          <TextField label={d.hasWpPassword ? 'Nova senha WP' : 'Senha WP'} type="password" value={pw} onChange={(e) => { setPw(e.target.value); setClearPw(false); }} sx={{ flex: 1 }}
            placeholder={d.hasWpPassword ? 'deixe vazio para manter' : ''} slotProps={{ htmlInput: { autoComplete: 'new-password' } }}
            helperText={d.hasWpPassword ? 'Senha cadastrada. Vazio mantém a atual.' : 'Fica criptografada no servidor'} />
        </Stack>
        {d.hasWpPassword && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            {shown == null
              ? <Button size="small" variant="outlined" startIcon={<VisibilityOutlinedIcon />} onClick={reveal}>Mostrar senha atual</Button>
              : <TextField size="small" value={shown} sx={{ minWidth: 240 }} slotProps={{ input: { readOnly: true, sx: { fontFamily: 'IBM Plex Mono' }, endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title="Copiar"><IconButton size="small" onClick={() => navigator.clipboard?.writeText(shown).catch(() => {})} aria-label="Copiar senha"><ContentCopyRoundedIcon fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Esconder"><IconButton size="small" onClick={() => setShown(null)} aria-label="Esconder senha"><VisibilityOffOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                  </InputAdornment>) } }} />}
            <FormControlLabel control={<Checkbox size="small" checked={clearPw} onChange={(e) => { setClearPw(e.target.checked); if (e.target.checked) setPw(''); }} />} label={<Typography sx={{ fontSize: 13 }}>Apagar senha</Typography>} />
          </Stack>
        )}
        {pwErr && <Alert severity="error" variant="outlined">{pwErr}</Alert>}
        <Typography variant="caption" sx={{ mt: -0.75 }}>A senha WP fica criptografada (não aparece na lista nem nas respostas da API). “Mostrar senha” abre uma vez e registra quem abriu.</Typography>
        <Divider />
        <Stack spacing={0.75}>
          <Typography variant="overline">Gestores e contas de anúncios do domínio</Typography>
          {d.managers.length ? d.managers.map((m) => {
            const nm = (ids: string[], list?: { id: string; name: string }[]) => ids.map((id) => list?.find((a) => a.id === id)?.name ?? id).join(', ');
            return (
              <Stack key={m.userId} direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                <Typography sx={{ fontWeight: 600, fontSize: 13.5 }}>{m.name}{m.sharePct != null && d.managers.length > 1 ? ` · ${String(m.sharePct).replace('.', ',')}%` : ''}</Typography>
                <Typography variant="caption">Google: {nm(m.googleAccounts, ga?.accounts) || '—'} · Meta: {nm(m.metaAccounts, ma?.accounts) || '—'}</Typography>
              </Stack>
            );
          }) : <Typography variant="caption">Nenhum gestor ainda.</Typography>}
          <Typography variant="caption">Os vínculos de gestores e contas Google Ads / Meta Ads são feitos só em Configurações → Usuários & Squads → editar o gestor → Domínios. A despesa dessas contas é a que entra no ROI do domínio e na comissão do gestor.</Typography>
        </Stack>
        {multiMgr && (
          <Stack spacing={1}>
            <Divider />
            <Typography variant="overline" sx={{ mb: -0.5 }}>Rateio</Typography>
            <Typography variant="caption">Quanto da receita do domínio vai para cada gestor no ROI e na comissão. Cada um desconta só as despesas das próprias contas. Os períodos de “Gestores e sites” (edição do gestor) valem por cima deste rateio nos dias que cobrem.</Typography>
            <FormControlLabel control={<Switch checked={useShares} onChange={(e) => setUseShares(e.target.checked)} />} label={<Typography sx={{ fontSize: 13.5 }}>{useShares ? 'Porcentagens definidas' : 'Dividir igualmente entre os gestores'}</Typography>} />
            {useShares && (<>
              {d.managers.map((m) => (
                <Stack key={m.userId} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <Typography sx={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{m.name}</Typography>
                  <TextField size="small" value={shares[m.userId] ?? ''} onChange={(e) => setShares({ ...shares, [m.userId]: e.target.value })} sx={{ width: 130 }}
                    slotProps={{ htmlInput: { inputMode: 'decimal', 'aria-label': `Rateio de ${m.name}` }, input: { endAdornment: <InputAdornment position="end">%</InputAdornment> } }} />
                </Stack>
              ))}
              <Typography variant="caption" sx={{ color: Math.abs(shareSum - 100) > 0.001 ? 'error.main' : 'success.main', fontWeight: 600 }}>
                Soma: {String(shareSum).replace('.', ',')}% {Math.abs(shareSum - 100) > 0.001 ? '· precisa ser 100%' : '✓'}
              </Typography>
            </>)}
            {!hasShares && <Typography variant="caption">Hoje: dividido igualmente ({String(Math.round((100 / d.managers.length) * 1000) / 1000).replace('.', ',')}% cada). Ao entrar ou sair um gestor do domínio, o rateio volta para partes iguais.</Typography>}
          </Stack>
        )}
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
  const { data: gam } = useIntegrationAccounts('gam');
  const [host, setHost] = useState(''); const [msg, setMsg] = useState('');
  const [edit, setEdit] = useState<Domain | null>(null);
  const [del, setDel] = useState<Domain | null>(null);
  const create = useAdminMutation(adminApi.createDomain, INV);
  const toggle = useAdminMutation(({ h, active }: { h: string; active: boolean }) => adminApi.updateDomain(h, { active }), INV);
  const remove = useAdminMutation(adminApi.deleteDomain, INV);
  if (error) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  const tech = data.domains.find((x) => x.technical);
  const d = data.domains.filter((x) => !x.technical); const act = d.filter((x) => x.active).length; const noSq = d.filter((x) => x.active && !x.squadId).length;
  const expiring = d.filter((x) => x.expiresOn && daysTo(x.expiresOn) <= 30).length;
  const accName = (id: string) => [...(ga?.accounts ?? []), ...(ma?.accounts ?? [])].find((a) => a.id === id)?.name ?? id;
  const add = () => {
    const v = clean(host);
    if (!HOST_RE.test(v)) return setMsg('Digite um domínio válido, ex.: novodominio.com');
    setMsg(''); create.mutate(v, { onSuccess: () => setHost(''), onError: (e) => setMsg(e instanceof ApiError ? e.message : 'Não foi possível adicionar.') });
  };
  return (
    <>
      <PageHead title="Domínios" sub="Cadastro dos sites: Squad, conta do Ad Manager, contas de tráfego, gestores e registro (onde foi comprado, vencimento, hospedagem e acesso WP)." />
      <Grid container spacing={1.75} sx={{ mb: 1.75 }}>
        {([['Total de domínios', d.length], ['Ativos', act], ['Domínios sem Squad', noSq], ['Registro vence em 30 dias', expiring]] as const).map(([l, v]) => (
          <Grid key={l} size={{ xs: 6, md: 3 }}><Card sx={{ p: 2.25 }}><Typography variant="caption">{l}</Typography><Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: 28, color: (l === 'Domínios sem Squad' || l === 'Registro vence em 30 dias') && v > 0 ? 'warning.main' : undefined }}>{v}</Typography></Card></Grid>
        ))}
      </Grid>
      <Card>
        <CardHeader title="Domínios" action={<Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}><TextField size="small" placeholder="novodominio.com" value={host} onChange={(e) => setHost(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} error={!!msg} helperText={msg || undefined} /><Button variant="contained" size="small" onClick={add} disabled={create.isPending}>Adicionar domínio</Button></Stack>} />
        <TableContainer><Table>
          <TableHead><TableRow>{['Domínio', 'Squad', 'Gestores', 'Google Ads', 'Meta Ads', 'Ad Manager', 'Registro · hospedagem', 'revShare', 'Status', 'Último dado', ''].map((h) => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>{d.map((x) => (
            <TableRow key={x.hostname}>
              <TableCell><b>{x.hostname}</b>{x.createdBySync && <Typography variant="caption" component="div" sx={{ color: 'warning.main' }}>Visto no Ad Manager · ative para cadastrar</Typography>}</TableCell>
              <TableCell>{sq?.squads.find((s) => s.id === x.squadId)?.name ?? <Tag tone="warn">Sem Squad</Tag>}</TableCell>
              <TableCell sx={{ whiteSpace: 'normal' }}>{x.managers.map((m) => m.name).join(', ') || '—'}</TableCell>
              <TableCell sx={{ whiteSpace: 'normal' }}>{x.googleAccounts.map(accName).join(', ') || '—'}</TableCell>
              <TableCell sx={{ whiteSpace: 'normal' }}>{x.metaAccounts.map(accName).join(', ') || '—'}</TableCell>
              <TableCell sx={{ whiteSpace: 'normal' }}>{gam?.accounts.find((a) => a.id === x.gamAccountId)?.name ?? '—'}</TableCell>
              <TableCell sx={{ whiteSpace: 'normal', minWidth: 150 }}>
                {x.registrar || x.expiresOn || x.hosting || x.wpUser ? <>
                  <Typography sx={{ fontSize: 13 }}>{x.registrar || 'Registro não informado'}</Typography>
                  {x.expiresOn && <ExpiryTag iso={x.expiresOn} />}
                  {(x.hosting || x.wpUser) && <Typography variant="caption" component="div" color="text.secondary">{[x.hosting, x.wpUser && `WP: ${x.wpUser}${x.hasWpPassword ? ' · senha salva' : ''}`].filter(Boolean).join(' · ')}</Typography>}
                </> : '—'}
              </TableCell>
              <TableCell>{String(x.revShare ?? 0).replace('.', ',')}%</TableCell>
              <TableCell>{x.active ? <Tag tone="pos">Ativo</Tag> : <Tag>Inativo</Tag>}</TableCell><TableCell>{relTime(x.lastDataAt)}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                <Button size="small" variant="outlined" onClick={() => toggle.mutate({ h: x.hostname, active: !x.active })}>{x.active ? 'Desativar' : 'Ativar'}</Button>{' '}
                <Tooltip title="Editar"><IconButton size="small" onClick={() => setEdit(x)} aria-label={`Editar ${x.hostname}`}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>{' '}
                <Tooltip title="Excluir"><IconButton size="small" onClick={() => setDel(x)} aria-label={`Excluir ${x.hostname}`}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip>
              </TableCell>
            </TableRow>
          ))}
          {tech && (
            <TableRow sx={{ bgcolor: 'rgba(255,255,255,.02)' }}>
              <TableCell sx={{ whiteSpace: 'normal', maxWidth: 240 }}><b>Sem domínio</b><Typography variant="caption" component="div">Domínio técnico: custo de campanhas sem site identificável (ex.: Meta de mensagens). Só Admin vê.</Typography></TableCell>
              <TableCell colSpan={8} sx={{ color: 'text.secondary', whiteSpace: 'normal' }}>Não entra em Squad, gestor, conta nem Ad Manager. Para tirar uma campanha daqui, defina o domínio dela.</TableCell>
              <TableCell>{relTime(tech.lastDataAt)}</TableCell>
              <TableCell align="right"><Button size="small" variant="outlined" component={RouterLink} to="/admin/integracoes/meta-ads">Definir domínios</Button></TableCell>
            </TableRow>
          )}
          </TableBody>
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
