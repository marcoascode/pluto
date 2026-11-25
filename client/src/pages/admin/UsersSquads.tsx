import { Alert, Avatar, AvatarGroup, Box, Button, Card, CardContent, CardHeader, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, IconButton, InputAdornment, ListItemText, MenuItem, Snackbar, Stack, Switch, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ForwardToInboxOutlinedIcon from '@mui/icons-material/ForwardToInboxOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import EventNoteOutlinedIcon from '@mui/icons-material/EventNoteOutlined';
import { teamApi, type TeamGestor, type TeamResponse } from '@/lib/team';
import { GestorPeriodsDialog } from './GestorPeriods';
import { CommissionTiersEditor, parseTiers, toDraft } from './CommissionTiersEditor';
import { DEFAULT_FIXED_PCT, DEFAULT_TIER_CURRENCY, type Tier } from '@/lib/financeOps';
import { useAuth } from '@/context/AuthContext';
import { ROLE_HELP, ROLE_LABEL, roleTone } from '@/lib/roles';
import { useAdminCompanies, useAdminDomains, useAdminMutation, useIntegrationAccounts, usePermissions, useSquads, useUsers } from '@/hooks/queries';
import { adminApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';
import { ConfirmDialog, ErrorBox, PageHead, PageSkeleton, Tag } from '@/components/ui/States';
import { initials } from '@/lib/format';
import type { Capability, CommissionMode, Company, Currency, DomainLink, Role, User } from '@/types/api';

/* =====================================================================
   Usuários & Squads
   - Gestor: domínio(s) que gere + as contas Google Ads / Meta Ads que usa em cada um (vê só essas campanhas).
   - Gerente: vê vários Squads inteiros, sem administração.
   - Empresa: sociedade (sócios) que agrupa Squads. Sócio vê a Empresa inteira, em qualquer papel.
   ===================================================================== */
type TabKey = 'users' | 'squads' | 'companies' | 'perms';
const avatarSx = { width: 28, height: 28, fontSize: 11, fontWeight: 600, background: 'linear-gradient(135deg,#2f6fe0,#1b3f86)', color: '#fff' };
const INV = [qk.users, qk.squads, qk.adminCompanies, qk.adminDomains, qk.myCompanies, qk.myDomainsAll];

export default function UsersSquadsPage() {
  const [tab, setTab] = useState<TabKey>('users');
  const { isAdmin } = useAuth();
  if (!isAdmin) return <TeamPage />;   // 0.18.9: Gerente atribui domínios e contas aos gestores do alcance dele
  return (
    <>
      <PageHead title="Usuários & Squads" sub="Gestor = domínio + contas. Gerente = vários Squads. Empresa = sócios + Squads." />
      <Tabs value={tab} onChange={(_, v: TabKey) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }} variant="scrollable" allowScrollButtonsMobile>
        <Tab value="users" label="Usuários" /><Tab value="squads" label="Squads" /><Tab value="companies" label="Empresas" /><Tab value="perms" label="Permissões" />
      </Tabs>
      {tab === 'users' && <UsersTab />}
      {tab === 'squads' && <SquadsTab />}
      {tab === 'companies' && <CompaniesTab />}
      {tab === 'perms' && <PermsTab />}
    </>
  );
}

/* ---------------- Usuários ---------------- */
function UsersTab() {
  const { data, error, refetch } = useUsers();
  const { data: sq } = useSquads();
  const { data: co } = useAdminCompanies();
  const [form, setForm] = useState<User | 'new' | null>(null);
  const [created, setCreated] = useState<{ user: User; inviteSent: boolean } | null>(null);
  const [del, setDel] = useState<User | null>(null);
  const [toast, setToast] = useState('');
  const { user: me, isSuperAdmin } = useAuth();
  const remove = useAdminMutation(adminApi.deleteUser, INV);
  const resend = useAdminMutation(adminApi.resendInvite, [qk.users]);
  // 0.18: flag da criação automatizada de campanhas Meta — só o SuperAdmin vê e altera (o servidor responde 403 para os demais)
  const metaFlag = useAdminMutation(adminApi.setMetaCampaigns, [qk.users]);
  const toggleMeta = (u: User, enabled: boolean) => metaFlag.mutate({ id: u.id, enabled }, { onSuccess: () => setToast(`${enabled ? 'Criação de campanhas Meta liberada para' : 'Criação de campanhas Meta removida de'} ${u.name}`), onError: (e) => setToast(e instanceof ApiError ? e.message : 'Não foi possível alterar a permissão.') });
  // 0.18.14: flag do Fluxo de caixa — mesma regra (só o SuperAdmin vê e altera)
  const cashFlag = useAdminMutation(adminApi.setCashflow, [qk.users]);
  const toggleCash = (u: User, enabled: boolean) => cashFlag.mutate({ id: u.id, enabled }, { onSuccess: () => setToast(`${enabled ? 'Fluxo de caixa liberado para' : 'Fluxo de caixa removido de'} ${u.name}`), onError: (e) => setToast(e instanceof ApiError ? e.message : 'Não foi possível alterar a permissão.') });
  if (error) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  const access = (u: User) => {
    if (u.role === 'superadmin') return <Typography variant="caption">Todos os domínios</Typography>;
    if (u.role === 'admin') return <Typography variant="caption">Domínios das Empresas em que é sócio</Typography>;
    if (u.role === 'gerente') return u.squadIds.length ? <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>{u.squadIds.map((id) => <Tag key={id}>{sq?.squads.find((s) => s.id === id)?.name ?? id}</Tag>)}</Stack> : <Typography variant="caption">Só as Empresas dele</Typography>;
    return u.domains.length
      ? <Tooltip title={u.domains.map((d) => `${d.domain} (${d.googleAccounts.length} Google · ${d.metaAccounts.length} Meta)`).join('\n')}><Typography variant="body2">{u.domains.length === 1 ? u.domains[0].domain : `${u.domains.length} domínios`}<Typography component="span" variant="caption"> · {u.domains.reduce((a, d) => a + d.googleAccounts.length + d.metaAccounts.length, 0)} contas · comissão {u.commissionMode === 'fixed' ? `fixa ${String(u.commissionPct ?? DEFAULT_FIXED_PCT).replace('.', ',')}%` : `progressiva ${(u.commissionTiers?.length ? u.commissionTiers : [{ pct: 10 }, { pct: 12 }, { pct: 15 }]).map((t) => String(t.pct).replace('.', ',')).join('/')}%`}</Typography></Typography></Tooltip>
      : <Tag tone="warn">Sem domínio</Tag>;
  };
  return (
    <>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.75 }}>
        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setForm('new')}>Adicionar usuário</Button>
        <Typography variant="caption">O convite com a senha temporária é enviado pelo servidor.</Typography>
      </Stack>
      <TableContainer component={Card}><Table>
        <TableHead><TableRow>{[...['Nome', 'E-mail', 'Permissão', 'Acesso', 'Sócio de', 'Status'], ...(isSuperAdmin ? ['Criação Automatizada de Campanhas Meta', 'Fluxo de caixa'] : []), ''].map((h) => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead>
        <TableBody>{data.users.map((u) => (
          <TableRow key={u.id}>
            <TableCell><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Avatar sx={avatarSx}>{initials(u.name)}</Avatar><span>{u.name}</span></Stack></TableCell>
            <TableCell>{u.email}</TableCell>
            <TableCell><Tag tone={roleTone(u.role)}>{ROLE_LABEL[u.role] ?? u.role}</Tag></TableCell>
            <TableCell sx={{ whiteSpace: 'normal', maxWidth: 260 }}>{access(u)}</TableCell>
            <TableCell sx={{ whiteSpace: 'normal' }}>{u.companyIds.length ? <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>{u.companyIds.map((id) => <Chip key={id} size="small" icon={<ApartmentRoundedIcon sx={{ fontSize: '14px !important' }} />} label={co?.companies.find((c) => c.id === id)?.name ?? id} sx={{ height: 22 }} />)}</Stack> : '—'}</TableCell>
            <TableCell>{u.status === 'active' ? <Tag tone="pos">Ativo</Tag> : <Tag tone="warn">{u.status === 'invited' ? 'Convite enviado' : 'Desativado'}</Tag>}</TableCell>
            {isSuperAdmin && (
              <TableCell>
                <Tooltip title={u.status === 'disabled' && !u.canCreateMetaCampaigns ? 'Usuário desativado não pode receber essa permissão' : 'Libera as telas “Criar campanhas Meta” e “Perfis & BMs” para este usuário'}>
                  <span><Switch size="small" checked={!!u.canCreateMetaCampaigns} disabled={metaFlag.isPending || (u.status === 'disabled' && !u.canCreateMetaCampaigns)}
                    onChange={(_, v) => toggleMeta(u, v)} slotProps={{ input: { 'aria-label': `Criação Automatizada de Campanhas Meta para ${u.name}` } }} /></span>
                </Tooltip>
              </TableCell>
            )}
            {isSuperAdmin && (
              <TableCell>
                <Tooltip title={u.status === 'disabled' && !u.canUseCashflow ? 'Usuário desativado não pode receber essa permissão' : 'Libera a tela “Fluxo de caixa” (faturas de cartão) para este usuário'}>
                  <span><Switch size="small" checked={!!u.canUseCashflow} disabled={cashFlag.isPending || (u.status === 'disabled' && !u.canUseCashflow)}
                    onChange={(_, v) => toggleCash(u, v)} slotProps={{ input: { 'aria-label': `Fluxo de caixa para ${u.name}` } }} /></span>
                </Tooltip>
              </TableCell>
            )}
            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
              {u.status === 'invited' && <Tooltip title="Reenviar convite"><IconButton size="small" aria-label={`Reenviar convite para ${u.name}`} onClick={() => resend.mutate(u.id, { onSuccess: () => setToast(`Convite reenviado para ${u.email}`), onError: (e) => setToast(e instanceof ApiError ? e.message : 'Falhou') })}><ForwardToInboxOutlinedIcon fontSize="small" /></IconButton></Tooltip>}{' '}
              <Tooltip title="Editar"><span><IconButton size="small" aria-label={`Editar ${u.name}`} disabled={(!!u.isMainAdmin && u.id !== me?.id) || (u.role === 'superadmin' && !isSuperAdmin)} onClick={() => setForm(u)}><EditOutlinedIcon fontSize="small" /></IconButton></span></Tooltip>{' '}
              <Tooltip title={u.isMainAdmin ? 'O admin principal não pode ser excluído' : u.id === me?.id ? 'Você não pode excluir a si mesmo' : 'Excluir'}><span><IconButton size="small" aria-label={`Excluir ${u.name}`} disabled={!!u.isMainAdmin || u.id === me?.id || (u.role === 'superadmin' && !isSuperAdmin)} onClick={() => setDel(u)}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></span></Tooltip>
            </TableCell>
          </TableRow>
        ))}</TableBody>
      </Table></TableContainer>
      {form && <UserDialog key={form === 'new' ? 'new' : form.id} u={form === 'new' ? null : form} self={form !== 'new' && form.id === me?.id} onClose={() => setForm(null)} onCreated={(r) => { setForm(null); setCreated(r); }} />}
      <Dialog open={!!created} onClose={() => setCreated(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Usuário criado<Typography variant="caption" component="div">{created?.inviteSent ? 'O servidor enviou o convite por e-mail' : 'O convite NÃO foi enviado'}</Typography></DialogTitle>
        <DialogContent>
          {created && !created.inviteSent && <Alert severity="warning" variant="outlined" sx={{ mb: 1.5 }}>O servidor não conseguiu enviar o e-mail (SMTP não configurado ou fora do ar). Configure o SMTP e use “Reenviar convite” na lista de usuários.</Alert>}
          {created && (
            <Box sx={{ bgcolor: '#f5f7fb', color: '#1c2536', borderRadius: 2.5, p: 2.5, fontSize: 14, lineHeight: 1.6 }}>
              <Box sx={{ fontSize: 12, color: '#5b6679', borderBottom: '1px solid #dde3ec', pb: 1.25, mb: 1.5, display: 'grid', gap: 0.25 }}>
                <span><b>De:</b> Pluto Mídia &lt;admin@plutomidia.com.br&gt;</span><span><b>Para:</b> {created.user.email}</span><span><b>Assunto:</b> Seu acesso ao Pluto Mídia</span>
              </Box>
              <p style={{ margin: '0 0 10px' }}>Olá {created.user.name.split(' ')[0]},</p><p style={{ margin: '0 0 10px' }}>Seu acesso ao Pluto Mídia foi criado.</p>
              <p style={{ margin: 0 }}>Login: <b>{created.user.email}</b><br />Senha temporária: <b>enviada neste e-mail</b></p>
              <p style={{ margin: '10px 0 0', fontSize: 13, color: '#5b6679' }}>Por segurança, altere sua senha no primeiro acesso.</p>
            </Box>
          )}
          <Typography variant="caption" component="p" sx={{ mt: 1.5 }}>A senha temporária é gerada e enviada só pelo servidor. O front nunca vê a senha.</Typography>
        </DialogContent>
        <DialogActions><Button variant="contained" onClick={() => setCreated(null)}>Fechar</Button></DialogActions>
      </Dialog>
      <ConfirmDialog open={!!del} title="Excluir usuário?" busy={remove.isPending} onClose={() => { setDel(null); remove.reset(); }} onConfirm={() => del && remove.mutate(del.id, { onSuccess: () => setDel(null) })}>
        <b>{del?.name}</b> ({del?.email}) perde o acesso na hora e todas as sessões dele são encerradas. Para só bloquear, edite e escolha <b>Desativado</b>.
        {remove.error && <Alert severity="error" variant="outlined" sx={{ mt: 1.5 }}>{remove.error instanceof ApiError ? remove.error.message : 'Não foi possível excluir.'}</Alert>}
      </ConfirmDialog>
      <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast('')} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </>
  );
}

/** Multi-seleção simples com checkboxes. */
function Multi({ label, value, options, onChange, helper, disabled }: { label: string; value: string[]; options: { id: string; name: string; sub?: string }[]; onChange: (v: string[]) => void; helper?: string; disabled?: boolean }) {
  return (
    <TextField select label={label} value={value} fullWidth disabled={disabled} helperText={helper} onChange={(e) => onChange(typeof e.target.value === 'string' ? e.target.value.split(',').filter(Boolean) : (e.target.value as string[]))}
      slotProps={{ inputLabel: { shrink: true }, select: { multiple: true, displayEmpty: true, renderValue: (v) => (v as string[]).map((id) => options.find((o) => o.id === id)?.name ?? id).join(', ') || 'Nenhuma' } }}>
      {options.map((o) => <MenuItem key={o.id} value={o.id}><Checkbox size="small" checked={value.includes(o.id)} /><ListItemText primary={o.name} secondary={o.sub} /></MenuItem>)}
      {!options.length && <MenuItem disabled>Nada cadastrado</MenuItem>}
    </TextField>
  );
}

/** Gestor: cada linha = domínio + contas Google Ads + contas Meta Ads que ele usa nesse domínio.
 *  0.18.8: é o ÚNICO lugar onde usuário × domínio × conta são ligados. A despesa dessas contas no domínio é a que sai da
 *  receita do site no ROI do gestor (e na comissão); o site em que o sync põe a despesa da conta vem daqui. */
interface LinkOptions { domains: { hostname: string; active: boolean }[]; google: { id: string; name: string; externalId: string }[]; meta: { id: string; name: string; externalId: string }[] }
/** Admin: todos os domínios e contas. */
function AdminLinksEditor({ value, onChange }: { value: DomainLink[]; onChange: (v: DomainLink[]) => void }) {
  const { data: doms } = useAdminDomains();
  const { data: ga } = useIntegrationAccounts('google-ads');
  const { data: ma } = useIntegrationAccounts('meta');
  const options: LinkOptions = { domains: (doms?.domains ?? []).filter((d) => !d.technical), google: ga?.accounts ?? [], meta: ma?.accounts ?? [] };
  return <DomainLinksEditor value={value} onChange={onChange} options={options} />;
}
export function DomainLinksEditor({ value, onChange, options }: { value: DomainLink[]; onChange: (v: DomainLink[]) => void; options: LinkOptions }) {
  const opts = (list: { id: string; name: string; externalId: string }[]) => list.map((a) => ({ id: a.id, name: a.name, sub: a.externalId }));
  const free = options.domains.filter((d) => d.active || value.some((v) => v.domain === d.hostname));
  const set = (i: number, patch: Partial<DomainLink>) => onChange(value.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Box><Typography variant="overline">Domínios que gere</Typography><Typography variant="caption" component="div">As despesas das contas escolhidas saem da receita do domínio no ROI e na comissão do gestor. Mudanças valem a partir de hoje.</Typography></Box>
        <Button size="small" startIcon={<AddRoundedIcon />} disabled={!free.some((d) => !value.some((v) => v.domain === d.hostname))}
          onClick={() => { const d = free.find((x) => !value.some((v) => v.domain === x.hostname)); if (d) onChange([...value, { domain: d.hostname, googleAccounts: [], metaAccounts: [] }]); }}>Adicionar domínio</Button>
      </Stack>
      {value.map((l, i) => (
        <Card key={i} variant="outlined" sx={{ p: 1.5, bgcolor: 'action.hover' }}>
          <Stack spacing={1.25}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <TextField select size="small" label="Domínio" value={l.domain} onChange={(e) => set(i, { domain: e.target.value })} sx={{ flex: 1 }}>
                {free.filter((d) => d.hostname === l.domain || !value.some((v) => v.domain === d.hostname)).map((d) => <MenuItem key={d.hostname} value={d.hostname}>{d.hostname}</MenuItem>)}
              </TextField>
              <Tooltip title="Tirar este domínio"><IconButton size="small" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Tirar ${l.domain}`}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Multi label="Contas Google Ads" value={l.googleAccounts} options={opts(options.google)} onChange={(v) => set(i, { googleAccounts: v })} />
              <Multi label="Contas Meta Ads" value={l.metaAccounts} options={opts(options.meta)} onChange={(v) => set(i, { metaAccounts: v })} />
            </Stack>
            {!l.googleAccounts.length && !l.metaAccounts.length && <Typography variant="caption" sx={{ color: 'warning.main' }}>Sem conta, o gestor não vê nenhuma campanha deste domínio.</Typography>}
          </Stack>
        </Card>
      ))}
      {!value.length && <Typography variant="caption">Nenhum domínio. O gestor só vai ver dados depois de ligar pelo menos um domínio e uma conta.</Typography>}
    </Stack>
  );
}

function UserDialog({ u, self, onClose, onCreated }: { u: User | null; self: boolean; onClose: () => void; onCreated: (r: { user: User; inviteSent: boolean }) => void }) {
  const { data: sq } = useSquads();
  const { data: co } = useAdminCompanies();
  const { isSuperAdmin } = useAuth();
  const [f, setF] = useState({ name: u?.name ?? '', email: u?.email ?? '', role: u?.role ?? ('gestor' as Role), status: u?.status === 'disabled' ? 'disabled' : 'active', squadIds: u?.squadIds ?? [], companyIds: u?.companyIds ?? [], domains: u?.domains ?? [],
    commissionMode: u?.commissionMode ?? ('progressive' as CommissionMode), commissionPct: String(u?.commissionPct ?? DEFAULT_FIXED_PCT).replace('.', ','),
    commissionTiers: toDraft(u?.commissionTiers), commissionTierCurrency: (u?.commissionTiers?.length ? u.commissionTierCurrency : undefined) ?? (DEFAULT_TIER_CURRENCY as Currency) });
  const [err, setErr] = useState('');
  const [periods, setPeriods] = useState(false);
  const create = useAdminMutation(adminApi.createUser, INV);
  const save = useAdminMutation((b: Parameters<typeof adminApi.updateUser>[1]) => adminApi.updateUser(u!.id, b), INV);
  const busy = create.isPending || save.isPending;
  const submit = () => {
    if (!f.name.trim()) return setErr('Digite o nome.');
    if (!u && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return setErr('Digite um e-mail válido.');
    const dup = f.domains.find((d, i) => f.domains.findIndex((x) => x.domain === d.domain) !== i);
    if (dup) return setErr(`O domínio ${dup.domain} está repetido.`);
    setErr('');
    const pct = Number(f.commissionPct.trim().replace(',', '.'));
    if (f.role === 'gestor' && f.commissionMode === 'fixed' && (!Number.isFinite(pct) || pct <= 0 || pct > 100)) return setErr('Na comissão fixa, informe a porcentagem (maior que 0 e até 100%).');
    const tiers = parseTiers(f.commissionTiers);
    if (f.role === 'gestor' && f.commissionMode === 'progressive' && typeof tiers === 'string') return setErr(tiers);
    const commission = f.role !== 'gestor' ? {} : f.commissionMode === 'fixed'
      ? { commissionMode: f.commissionMode, commissionPct: pct }
      : { commissionMode: f.commissionMode, commissionTiers: tiers as Tier[], commissionTierCurrency: f.commissionTierCurrency };
    const links = { squadIds: f.role === 'gerente' ? f.squadIds : [], companyIds: f.companyIds, domains: f.role === 'gestor' ? f.domains : [], ...commission };
    const onError = (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    if (!u) return create.mutate({ name: f.name.trim(), email: f.email.trim().toLowerCase(), role: f.role, ...links }, { onSuccess: onCreated, onError });
    save.mutate({ name: f.name.trim(), role: f.role, ...links, ...(u.status !== 'invited' ? { status: f.status as 'active' | 'disabled' } : {}) }, { onSuccess: onClose, onError });
  };
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{u ? 'Editar usuário' : 'Adicionar usuário'}{u && <Typography variant="caption" component="div">{u.email}</Typography>}</DialogTitle>
      <DialogContent><Grid container spacing={2.5} sx={{ pt: 1 }}>
        <Grid size={{ xs: 12, md: 5 }}><Stack spacing={1.75}>
          <TextField label="Nome" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} fullWidth placeholder="Nome Sobrenome" />
          {!u && <TextField label="E-mail" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} fullWidth placeholder="pessoa@exemplo.com" />}
          <TextField select label="Permissão" value={f.role} disabled={self} helperText={self ? 'Você não pode mudar a sua própria permissão.' : ROLE_HELP[f.role]} onChange={(e) => setF({ ...f, role: e.target.value as Role })} fullWidth>
            <MenuItem value="gestor">Gestor</MenuItem><MenuItem value="gerente">Gerente</MenuItem><MenuItem value="admin">Admin</MenuItem>
            {(isSuperAdmin || u?.role === 'superadmin') && <MenuItem value="superadmin" disabled={!isSuperAdmin}>SuperAdmin</MenuItem>}
          </TextField>
          <Multi label="Sócio das Empresas" value={f.companyIds} options={(co?.companies ?? []).map((c) => ({ id: c.id, name: c.name, sub: `${c.squadIds.length} Squad(s)` }))} onChange={(v) => setF({ ...f, companyIds: v })}
            helper="Sócio vê todos os Squads e domínios da Empresa, completos." />
          {f.role === 'gestor' && (
            <Stack spacing={1.25}>
              <TextField select label="Modalidade de comissão" value={f.commissionMode} onChange={(e) => setF({ ...f, commissionMode: e.target.value as CommissionMode })} fullWidth
                helperText={f.commissionMode === 'progressive' ? 'A % depende do ROI total do mês, pelas faixas abaixo.' : 'Uma % única sobre o ROI total do mês nos sites que ele gere.'}>
                <MenuItem value="progressive">Progressiva (faixas de ROI)</MenuItem>
                <MenuItem value="fixed">Fixa</MenuItem>
              </TextField>
              {f.commissionMode === 'progressive' && (
                <CommissionTiersEditor value={f.commissionTiers} currency={f.commissionTierCurrency} onChange={(v) => setF({ ...f, commissionTiers: v })} onCurrency={(c) => setF({ ...f, commissionTierCurrency: c })} />
              )}
              {f.commissionMode === 'fixed' && (
                <TextField label="Comissão fixa" value={f.commissionPct} onChange={(e) => setF({ ...f, commissionPct: e.target.value })} fullWidth placeholder="10"
                  slotProps={{ htmlInput: { inputMode: 'decimal' }, input: { endAdornment: <InputAdornment position="end">%</InputAdornment> } }} helperText="Aplicada ao ROI total do gestor no mês (sem ROI positivo, sem comissão)." />
              )}
            </Stack>
          )}
          {u && u.status !== 'invited' && (
            <TextField select label="Status" value={f.status} disabled={self} onChange={(e) => setF({ ...f, status: e.target.value })} fullWidth helperText="Desativado não consegue entrar, mas o usuário continua cadastrado.">
              <MenuItem value="active">Ativo</MenuItem><MenuItem value="disabled">Desativado</MenuItem>
            </TextField>
          )}
        </Stack></Grid>
        <Grid size={{ xs: 12, md: 7 }}>
          {f.role === 'gestor' && <AdminLinksEditor value={f.domains} onChange={(v) => setF({ ...f, domains: v })} />}
          {f.role === 'gestor' && u?.role === 'gestor' && (
            <Card variant="outlined" sx={{ p: 1.5, mt: 1.5 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
                <Box><Typography variant="overline">Gestores e sites (comissão)</Typography>
                  <Typography variant="caption" component="div">Períodos com datas e rateio por site. Nos dias que cobrem, valem no lugar do Rateio do domínio.</Typography></Box>
                <Button size="small" variant="outlined" startIcon={<EventNoteOutlinedIcon />} onClick={() => setPeriods(true)} sx={{ flexShrink: 0 }}>Gestores e sites</Button>
              </Stack>
            </Card>
          )}
          {f.role === 'gerente' && (
            <Stack spacing={1.25}>
              <Typography variant="overline">Squads que vê</Typography>
              <Multi label="Squads" value={f.squadIds} options={(sq?.squads ?? []).map((s) => ({ id: s.id, name: s.name, sub: `${s.domains.length} domínio(s)${s.companyId ? ' · ' + (co?.companies.find((c) => c.id === s.companyId)?.name ?? '') : ''}` }))} onChange={(v) => setF({ ...f, squadIds: v })} />
              <Typography variant="caption">Vai ver: {[...new Set([...(sq?.squads ?? []).filter((s) => f.squadIds.includes(s.id) || (s.companyId && f.companyIds.includes(s.companyId))).flatMap((s) => s.domains)])].join(', ') || 'nenhum domínio'}</Typography>
            </Stack>
          )}
          {(f.role === 'admin' || f.role === 'superadmin') && <Alert severity="info" variant="outlined">{f.role === 'superadmin' ? 'SuperAdmin vê todos os domínios.' : 'Admin vê só os domínios dos Squads das Empresas em que é sócio (marque em “Sócio das Empresas”).'} Squads e domínios de gestor não se aplicam.</Alert>}
        </Grid>
        {err && <Grid size={12}><Alert severity="error" variant="outlined">{err}</Alert></Grid>}
      </Grid></DialogContent>
      <DialogActions><Button variant="outlined" onClick={onClose}>Cancelar</Button><Button variant="contained" onClick={submit} disabled={busy}>{busy ? 'Salvando…' : u ? 'Salvar' : 'Criar usuário e enviar convite'}</Button></DialogActions>
      {periods && u && <GestorPeriodsDialog userId={u.id} userName={u.name} onClose={() => setPeriods(false)} />}
    </Dialog>
  );
}

/* ---------------- Gerente: domínios e contas dos gestores (0.18.9) ---------------- */
function TeamPage() {
  const { data, error, refetch } = useQuery({ queryKey: ['team'], queryFn: teamApi.list });
  const [edit, setEdit] = useState<TeamGestor | null>(null);
  if (error) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  return (
    <>
      <PageHead title="Usuários & Squads · Gestores" sub="Atribua aos gestores os domínios do seu alcance e as contas Google Ads / Meta Ads que eles usam em cada um." />
      <TableContainer component={Card}><Table>
        <TableHead><TableRow>{['Nome', 'E-mail', 'Domínios e contas', 'Status', ''].map((h) => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead>
        <TableBody>
          {data.gestores.map((g) => (
            <TableRow key={g.id}>
              <TableCell><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Avatar sx={avatarSx}>{initials(g.name)}</Avatar><span>{g.name}</span></Stack></TableCell>
              <TableCell>{g.email}</TableCell>
              <TableCell sx={{ whiteSpace: 'normal', maxWidth: 320 }}>
                {g.domains.length ? <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>{g.domains.map((d) => <Tag key={d.domain}>{d.domain} · {d.googleAccounts.length + d.metaAccounts.length} conta(s)</Tag>)}</Stack> : <Tag tone="warn">Sem domínio do seu alcance</Tag>}
                {g.otherDomains > 0 && <Typography variant="caption" component="div">+ {g.otherDomains} domínio(s) fora do seu alcance</Typography>}
              </TableCell>
              <TableCell>{g.status === 'active' ? <Tag tone="pos">Ativo</Tag> : <Tag tone="warn">{g.status === 'invited' ? 'Convite enviado' : 'Desativado'}</Tag>}</TableCell>
              <TableCell align="right"><Button size="small" startIcon={<EditOutlinedIcon fontSize="small" />} onClick={() => setEdit(g)}>Atribuir</Button></TableCell>
            </TableRow>
          ))}
          {!data.gestores.length && <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.disabled' }}>Nenhum gestor no seu alcance.</TableCell></TableRow>}
        </TableBody>
      </Table></TableContainer>
      {edit && <TeamDialog key={edit.id} g={edit} data={data} onClose={() => setEdit(null)} />}
    </>
  );
}
function TeamDialog({ g, data, onClose }: { g: TeamGestor; data: TeamResponse; onClose: () => void }) {
  const qc = useQueryClient();
  const [domains, setDomains] = useState<DomainLink[]>(g.domains);
  const [err, setErr] = useState('');
  const save = useMutation({ mutationFn: teamApi.save, onSuccess: async () => { await Promise.all([qc.invalidateQueries({ queryKey: ['team'] }), qc.invalidateQueries({ queryKey: ['links'] })]); onClose(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.') });
  const submit = () => {
    const dup = domains.find((d, i) => domains.findIndex((x) => x.domain === d.domain) !== i);
    if (dup) return setErr(`O domínio ${dup.domain} está repetido.`);
    setErr(''); save.mutate({ id: g.id, domains });
  };
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Domínios e contas · {g.name}<Typography variant="caption" component="div">{g.email}</Typography></DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}><DomainLinksEditor value={domains} onChange={setDomains} options={{ domains: data.domains, google: data.accounts.google, meta: data.accounts.meta }} /></Box>
        {g.otherDomains > 0 && <Alert severity="info" variant="outlined" sx={{ mt: 1.5 }}>{g.otherDomains} domínio(s) deste gestor estão fora do seu alcance e continuam como estão.</Alert>}
        {err && <Alert severity="error" variant="outlined" sx={{ mt: 1.5 }}>{err}</Alert>}
      </DialogContent>
      <DialogActions><Button variant="outlined" onClick={onClose}>Cancelar</Button><Button variant="contained" onClick={submit} disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button></DialogActions>
    </Dialog>
  );
}

/* ---------------- Squads ---------------- */
function SquadsTab() {
  const { isSuperAdmin } = useAuth();
  const { data, error, refetch } = useSquads();
  const { data: doms } = useAdminDomains();
  const { data: users } = useUsers();
  const { data: co } = useAdminCompanies();
  const [edit, setEdit] = useState<{ id?: string; name: string; domains: string[]; companyId: string | null } | null>(null);
  const save = useAdminMutation(adminApi.saveSquad, INV);
  const remove = useAdminMutation(adminApi.deleteSquad, INV);
  const [del, setDel] = useState<{ id: string; name: string } | null>(null);
  if (error) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  const active = doms?.domains.filter((d) => d.active && !d.technical) ?? [];
  return (
    <>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.75 }}>
        <Button variant="contained" onClick={() => setEdit({ name: `Squad ${String(data.squads.length + 1).padStart(2, '0')}`, domains: [], companyId: null })}>+ Criar Squad</Button>
        <Typography variant="caption">Squad agrupa domínios. Pertence a uma Empresa e pode ser visto por Gerentes.</Typography>
      </Stack>
      <Grid container spacing={1.75}>
        {edit && (
          <Grid size={{ xs: 12, md: 6 }}><Card><CardHeader title={edit.id ? 'Editar Squad' : 'Novo Squad'} /><CardContent><Stack spacing={1.5}>
            <TextField label="Nome" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} fullWidth />
            <TextField select label="Empresa" value={edit.companyId ?? ''} onChange={(e) => setEdit({ ...edit, companyId: e.target.value || null })} fullWidth>
              <MenuItem value="" disabled={!isSuperAdmin}>{isSuperAdmin ? 'Sem Empresa' : 'Escolha uma Empresa da qual você é sócio'}</MenuItem>{co?.companies.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
            <Multi label="Domínios" value={edit.domains} options={active.map((d) => { const other = data.squads.find((s) => s.id !== edit.id && s.domains.includes(d.hostname)); return { id: d.hostname, name: d.hostname, sub: other ? `hoje em ${other.name}` : undefined }; })} onChange={(v) => setEdit({ ...edit, domains: v })}
              helper="Um domínio fica em um Squad só: escolher aqui tira do Squad anterior." />
            <Stack direction="row" spacing={1}><Button variant="contained" onClick={() => save.mutate(edit, { onSuccess: () => setEdit(null) })}>Salvar</Button><Button variant="outlined" onClick={() => setEdit(null)}>Cancelar</Button></Stack>
            {save.error && <Alert severity="error" variant="outlined">{save.error instanceof ApiError ? save.error.message : 'Não foi possível salvar.'}</Alert>}
          </Stack></CardContent></Card></Grid>
        )}
        {data.squads.filter((s) => s.id !== edit?.id).map((s) => {
          const gestores = (users?.users ?? []).filter((u) => u.role === 'gestor' && u.domains.some((d) => s.domains.includes(d.domain)));
          const gerentes = (users?.users ?? []).filter((u) => u.role === 'gerente' && u.squadIds.includes(s.id));
          const company = co?.companies.find((c) => c.id === s.companyId);
          return (
            <Grid key={s.id} size={{ xs: 12, md: 6 }}><Card sx={{ height: '100%' }}>
              <CardHeader title={s.name} subheader={company ? <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}><ApartmentRoundedIcon sx={{ fontSize: 14 }} /><span>{company.name}</span></Stack> : 'Sem Empresa'}
                action={<Stack direction="row" spacing={0.5}><Button size="small" variant="outlined" onClick={() => setEdit({ id: s.id, name: s.name, domains: s.domains, companyId: s.companyId })}>Editar</Button><Tooltip title="Excluir Squad"><IconButton size="small" aria-label={`Excluir ${s.name}`} onClick={() => setDel(s)}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip></Stack>} />
              <CardContent><Stack spacing={1.5}>
                <Box><Typography variant="overline">Domínios</Typography><Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>{s.domains.map((d) => <Tag key={d}>{d}</Tag>)}{!s.domains.length && <Typography variant="caption">Nenhum</Typography>}</Stack></Box>
                <Box><Typography variant="overline">Gestores</Typography><People list={gestores} empty="Nenhum gestor ligado aos domínios deste Squad" /></Box>
                <Box><Typography variant="overline">Gerentes</Typography><People list={gerentes} empty="Nenhum" /></Box>
              </Stack></CardContent>
            </Card></Grid>
          );
        })}
      </Grid>
      <ConfirmDialog open={!!del} title="Excluir Squad?" busy={remove.isPending} onClose={() => { setDel(null); remove.reset(); }} onConfirm={() => del && remove.mutate(del.id, { onSuccess: () => setDel(null) })}>
        Os domínios de <b>{del?.name}</b> ficam sem Squad e os Gerentes deixam de ver este Squad. Os gestores continuam vendo os domínios deles.
        {remove.error && <Alert severity="error" variant="outlined" sx={{ mt: 1.5 }}>{remove.error instanceof ApiError ? remove.error.message : 'Não foi possível excluir.'}</Alert>}
      </ConfirmDialog>
    </>
  );
}
function People({ list, empty }: { list: User[]; empty: string }) {
  if (!list.length) return <Typography variant="caption">{empty}</Typography>;
  return <>{list.map((u) => <Stack key={u.id} direction="row" spacing={1} sx={{ alignItems: 'center', py: 0.4 }}><Avatar sx={{ ...avatarSx, width: 24, height: 24, fontSize: 10 }}>{initials(u.name)}</Avatar><span>{u.name}</span><Typography variant="caption">{u.email}</Typography></Stack>)}</>;
}

/* ---------------- Empresas ---------------- */
function CompaniesTab() {
  const { isSuperAdmin } = useAuth();
  const { data, error, refetch } = useAdminCompanies();
  const { data: sq } = useSquads();
  const { data: users } = useUsers();
  const [edit, setEdit] = useState<(Omit<Company, 'id'> & { id?: string }) | null>(null);
  const [del, setDel] = useState<Company | null>(null);
  const save = useAdminMutation(adminApi.saveCompany, INV);
  const remove = useAdminMutation(adminApi.deleteCompany, INV);
  if (error) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  const uname = (id: string) => users?.users.find((u) => u.id === id)?.name ?? id;
  return (
    <>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.75 }}>
        {isSuperAdmin && <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setEdit({ name: '', partnerIds: [], squadIds: [] })}>Criar Empresa</Button>}
        <Typography variant="caption">{isSuperAdmin ? '' : 'Você vê e edita só as Empresas em que é sócio; criar e excluir Empresa é com o SuperAdmin. '}Empresa = sociedade. Ex.: “Empresa do Fulano” com os sócios Fulano e Beltrano. Aparece no seletor “Empresa” do topo.</Typography>
      </Stack>
      <Grid container spacing={1.75}>
        {data.companies.map((c) => {
          const squads = (sq?.squads ?? []).filter((s) => c.squadIds.includes(s.id));
          return (
            <Grid key={c.id} size={{ xs: 12, md: 6 }}><Card sx={{ height: '100%' }}>
              <CardHeader avatar={<ApartmentRoundedIcon color="primary" />} title={c.name} subheader={`${squads.length} Squad(s) · ${squads.reduce((a, s) => a + s.domains.length, 0)} domínio(s)`}
                action={<Stack direction="row" spacing={0.5}><Button size="small" variant="outlined" onClick={() => setEdit(c)}>Editar</Button>{isSuperAdmin && <Tooltip title="Excluir Empresa"><IconButton size="small" aria-label={`Excluir ${c.name}`} onClick={() => setDel(c)}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip>}</Stack>} />
              <CardContent><Stack spacing={1.5}>
                <Box><Typography variant="overline">Sócios</Typography>
                  {c.partnerIds.length ? <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><AvatarGroup max={6} sx={{ '& .MuiAvatar-root': { ...avatarSx, width: 26, height: 26 } }}>{c.partnerIds.map((id) => <Avatar key={id}>{initials(uname(id))}</Avatar>)}</AvatarGroup><Typography variant="body2">{c.partnerIds.map(uname).join(' · ')}</Typography></Stack> : <Typography variant="caption">Nenhum sócio</Typography>}
                </Box>
                <Box><Typography variant="overline">Squads</Typography>
                  {squads.map((s) => <Stack key={s.id} direction="row" spacing={1} sx={{ alignItems: 'baseline', py: 0.25 }}><Typography sx={{ fontWeight: 600, fontSize: 13.5 }}>{s.name}</Typography><Typography variant="caption">{s.domains.join(', ') || 'sem domínios'}</Typography></Stack>)}
                  {!squads.length && <Typography variant="caption">Nenhum Squad</Typography>}
                </Box>
              </Stack></CardContent>
            </Card></Grid>
          );
        })}
        {!data.companies.length && <Grid size={12}><Card><CardContent><Typography variant="caption">{isSuperAdmin ? 'Nenhuma Empresa ainda. Crie uma para aparecer o seletor “Empresa” no topo do painel.' : 'Você não é sócio de nenhuma Empresa. Peça a um SuperAdmin para incluir você como sócio.'}</Typography></CardContent></Card></Grid>}
      </Grid>
      <Dialog open={!!edit} onClose={() => setEdit(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{edit?.id ? 'Editar Empresa' : 'Criar Empresa'}</DialogTitle>
        {edit && <DialogContent><Stack spacing={1.75} sx={{ pt: 1 }}>
          <TextField label="Nome" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} fullWidth placeholder="Empresa do Fulano" />
          <Multi label="Sócios" value={edit.partnerIds} options={(users?.users ?? []).map((u) => ({ id: u.id, name: u.name, sub: `${ROLE_LABEL[u.role]} · ${u.email}` }))} onChange={(v) => setEdit({ ...edit, partnerIds: v })}
            helper="Sócios veem todos os Squads e domínios desta Empresa." />
          <Multi label="Squads" value={edit.squadIds} options={(sq?.squads ?? []).map((s) => ({ id: s.id, name: s.name, sub: `${s.domains.length} domínio(s)${s.companyId && s.companyId !== edit.id ? ' · hoje em ' + (data.companies.find((c) => c.id === s.companyId)?.name ?? 'outra') : ''}` }))} onChange={(v) => setEdit({ ...edit, squadIds: v })}
            helper="Um Squad fica em uma Empresa só: escolher aqui tira da Empresa anterior." />
          {save.error && <Alert severity="error" variant="outlined">{save.error instanceof ApiError ? save.error.message : 'Não foi possível salvar.'}</Alert>}
        </Stack></DialogContent>}
        <DialogActions><Button variant="outlined" onClick={() => { setEdit(null); save.reset(); }}>Cancelar</Button>
          <Button variant="contained" disabled={!edit?.name.trim() || save.isPending} onClick={() => edit && save.mutate({ ...edit, name: edit.name.trim() }, { onSuccess: () => setEdit(null) })}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button></DialogActions>
      </Dialog>
      <ConfirmDialog open={!!del} title="Excluir Empresa?" busy={remove.isPending} onClose={() => { setDel(null); remove.reset(); }} onConfirm={() => del && remove.mutate(del.id, { onSuccess: () => setDel(null) })}>
        <b>{del?.name}</b> sai do seletor do topo. Os Squads dela ficam sem Empresa e os sócios deixam de ver os domínios por ser sócio (Gerentes e gestores continuam pelos vínculos deles).
      </ConfirmDialog>
    </>
  );
}

/* ---------------- Permissões ---------------- */
function PermsTab() {
  const { data, error, refetch } = usePermissions();
  const [sel, setSel] = useState<{ gestor: Capability[]; gerente: Capability[] } | null>(null);
  const save = useAdminMutation(adminApi.savePermissions, [qk.permissions, qk.me]);
  useEffect(() => { if (data) setSel({ gestor: data.roles.gestor, gerente: data.roles.gerente ?? [] }); }, [data]);
  if (error) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data || !sel) return <PageSkeleton />;
  const same = (a: Capability[], b: Capability[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const dirty = !same(sel.gestor, data.roles.gestor) || !same(sel.gerente, data.roles.gerente ?? []);
  const groups = ['Visualização', 'Administração'] as const;
  const toggle = (r: 'gestor' | 'gerente', c: Capability, on: boolean) => setSel({ ...sel, [r]: on ? [...sel[r], c] : sel[r].filter((x) => x !== c) });
  const fixed = (vals: boolean[]) => vals.map((v, i) => <TableCell key={i} align="center"><Checkbox size="small" checked={v} disabled /></TableCell>);
  return (
    <>
      <TableContainer component={Card}><Table>
        <TableHead><TableRow><TableCell>Permissão</TableCell>{['Gestor', 'Gerente', 'Admin', 'SuperAdmin'].map((h) => <TableCell key={h} align="center">{h}</TableCell>)}</TableRow></TableHead>
        <TableBody>
          <TableRow><TableCell>Dashboard, Domínios e Empresas</TableCell>{fixed([true, true, true, true])}</TableRow>
          <TableRow><TableCell>Escopo dos dados <LockOutlinedIcon sx={{ fontSize: 14, verticalAlign: -2, color: 'text.disabled' }} /><Typography variant="caption" component="div">Gestor: domínios e contas dele · Gerente: Squads dele · Sócio: a Empresa inteira · Admin: tudo</Typography></TableCell>{fixed([true, true, true, true])}</TableRow>
          {groups.map((g) => [
            <TableRow key={g}><TableCell colSpan={5} sx={{ bgcolor: 'action.hover', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'text.secondary' }}>{g}</TableCell></TableRow>,
            ...data.capabilities.filter((c) => c.group === g).map((c) => (
              <TableRow key={c.key}>
                <TableCell>{c.label}{c.adminOnly && <Tooltip title={c.superAdminOnly ? 'Só SuperAdmin' : 'Por segurança, só Admin e SuperAdmin'}><LockOutlinedIcon sx={{ fontSize: 14, verticalAlign: -2, ml: 0.75, color: 'text.disabled' }} /></Tooltip>}</TableCell>
                {(['gestor', 'gerente'] as const).map((r) => (
                  <TableCell key={r} align="center"><Checkbox size="small" disabled={c.adminOnly} checked={!c.adminOnly && sel[r].includes(c.key)} onChange={(e) => toggle(r, c.key, e.target.checked)} slotProps={{ input: { 'aria-label': `${ROLE_LABEL[r]}: ${c.label}` } }} /></TableCell>
                ))}
                <TableCell align="center"><Checkbox size="small" checked={data.roles.admin.includes(c.key)} disabled /></TableCell>
                <TableCell align="center"><Checkbox size="small" checked disabled /></TableCell>
              </TableRow>
            )),
          ])}
        </TableBody>
      </Table></TableContainer>
      <Stack direction="row" spacing={1} sx={{ mt: 1.75, alignItems: 'center' }}>
        <Button variant="contained" disabled={!dirty || save.isPending} onClick={() => save.mutate(sel)}>{save.isPending ? 'Salvando…' : 'Salvar permissões'}</Button>
        <Button variant="outlined" disabled={!dirty} onClick={() => setSel({ gestor: data.roles.gestor, gerente: data.roles.gerente ?? [] })}>Desfazer</Button>
        {save.isSuccess && !dirty && <Typography variant="caption">Salvo. Vale no próximo carregamento de cada usuário.</Typography>}
      </Stack>
      <Alert severity="info" variant="outlined" sx={{ mt: 1.75 }}>O escopo e as permissões são aplicados no servidor em toda consulta. Ninguém vê outro domínio, outra conta ou um módulo desligado mudando a URL ou chamando a API direto. Gerente nunca acessa a administração.</Alert>
    </>
  );
}
