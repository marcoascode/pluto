import { Alert, Avatar, Box, Button, Card, CardContent, CardHeader, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, FormGroup, Grid, IconButton, MenuItem, Snackbar, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ForwardToInboxOutlinedIcon from '@mui/icons-material/ForwardToInboxOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { ROLE_HELP, ROLE_LABEL, roleTone } from '@/lib/roles';
import { useAdminDomains, useAdminMutation, usePermissions, useSquads, useUsers } from '@/hooks/queries';
import { adminApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';
import { ConfirmDialog, ErrorBox, PageHead, PageSkeleton, Tag } from '@/components/ui/States';
import { initials } from '@/lib/format';
import type { Capability, Role, UpdateUserRequest, User } from '@/types/api';

type TabKey = 'users' | 'squads' | 'perms';
const avatarSx = { width: 28, height: 28, fontSize: 11, fontWeight: 600, background: 'linear-gradient(135deg,#2f6fe0,#1b3f86)', color: '#fff' };

export default function UsersSquadsPage() {
  const [tab, setTab] = useState<TabKey>('users');
  return (
    <>
      <PageHead title="Usuários & Squads" sub="Squad organiza o acesso dos gestores. Domínio é a unidade de performance." />
      <Tabs value={tab} onChange={(_, v: TabKey) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="users" label="Usuários" /><Tab value="squads" label="Squads" /><Tab value="perms" label="Permissões" />
      </Tabs>
      {tab === 'users' && <UsersTab />}
      {tab === 'squads' && <SquadsTab />}
      {tab === 'perms' && <PermsTab />}
    </>
  );
}

function UsersTab() {
  const { data, error, refetch } = useUsers();
  const { data: sq } = useSquads();
  const [f, setF] = useState<{ name: string; email: string; role: Role; squadId: string }>({ name: '', email: '', role: 'gestor', squadId: '' });
  const [err, setErr] = useState('');
  const [created, setCreated] = useState<User | null>(null);
  const [inviteSent, setInviteSent] = useState(true);
  const [edit, setEdit] = useState<User | null>(null);
  const [del, setDel] = useState<User | null>(null);
  const [toast, setToast] = useState('');
  const { user: me, isSuperAdmin } = useAuth();
  const create = useAdminMutation(adminApi.createUser, [qk.users, qk.squads]);
  const remove = useAdminMutation(adminApi.deleteUser, [qk.users, qk.squads]);
  const resend = useAdminMutation(adminApi.resendInvite, [qk.users]);
  if (error) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  const squadId = f.squadId || sq?.squads[0]?.id || '';
  const submit = () => {
    if (!f.name.trim()) return setErr('Digite o nome.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return setErr('Digite um e-mail válido.');
    setErr('');
    create.mutate({ name: f.name.trim(), email: f.email.trim().toLowerCase(), role: f.role, squadId: f.role === 'gestor' ? squadId : null }, {
      onSuccess: (r) => { setCreated(r.user); setInviteSent(r.inviteSent); setF({ name: '', email: '', role: 'gestor', squadId: '' }); },
      onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível criar o usuário.'),
    });
  };
  return (
    <Grid container spacing={1.75}>
      <Grid size={{ xs: 12, lg: 8 }}>
        <TableContainer component={Card}><Table>
          <TableHead><TableRow>{['Nome', 'E-mail', 'Permissão', 'Squad', 'Status', ''].map((h) => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>{data.users.map((u) => (
            <TableRow key={u.id}>
              <TableCell><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} ><Avatar sx={avatarSx}>{initials(u.name)}</Avatar><span>{u.name}</span></Stack></TableCell>
              <TableCell>{u.email}</TableCell>
              <TableCell><Tag tone={roleTone(u.role)}>{ROLE_LABEL[u.role] ?? u.role}</Tag></TableCell>
              <TableCell>{u.squadId ? sq?.squads.find((s) => s.id === u.squadId)?.name : <Typography variant="caption">Todos os domínios</Typography>}</TableCell>
              <TableCell>{u.status === 'active' ? <Tag tone="pos">Ativo</Tag> : <Tag tone="warn">{u.status === 'invited' ? 'Convite enviado' : 'Desativado'}</Tag>}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                {u.status === 'invited' && <Tooltip title="Reenviar convite"><IconButton size="small" aria-label={`Reenviar convite para ${u.name}`} onClick={() => resend.mutate(u.id, { onSuccess: () => setToast(`Convite reenviado para ${u.email}`), onError: (e) => setToast(e instanceof ApiError ? e.message : 'Falhou') })}><ForwardToInboxOutlinedIcon fontSize="small" /></IconButton></Tooltip>}{' '}
                <Tooltip title="Editar"><span><IconButton size="small" aria-label={`Editar ${u.name}`} disabled={(!!u.isMainAdmin && u.id !== me?.id) || (u.role === 'superadmin' && !isSuperAdmin)} onClick={() => setEdit(u)}><EditOutlinedIcon fontSize="small" /></IconButton></span></Tooltip>{' '}
                <Tooltip title={u.isMainAdmin ? 'O admin principal não pode ser excluído' : u.id === me?.id ? 'Você não pode excluir a si mesmo' : 'Excluir'}><span><IconButton size="small" aria-label={`Excluir ${u.name}`} disabled={!!u.isMainAdmin || u.id === me?.id || (u.role === 'superadmin' && !isSuperAdmin)} onClick={() => setDel(u)}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></span></Tooltip>
              </TableCell>
            </TableRow>
          ))}</TableBody>
        </Table></TableContainer>
      </Grid>
      <Grid size={{ xs: 12, lg: 4 }}>
        <Card><CardHeader title="Adicionar usuário" /><CardContent><Stack spacing={1.75}>
          <TextField label="Nome" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Lucas Exemplo" fullWidth />
          <TextField label="E-mail" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="gestor@exemplo.com" fullWidth />
          <TextField select label="Permissão" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })} fullWidth><MenuItem value="gestor">Gestor</MenuItem><MenuItem value="admin">Admin</MenuItem>{isSuperAdmin && <MenuItem value="superadmin">SuperAdmin</MenuItem>}</TextField>
          {f.role === 'gestor' ? (
            <TextField select label="Squad" value={squadId} onChange={(e) => setF({ ...f, squadId: e.target.value })} fullWidth helperText={`Vai ver: ${sq?.squads.find((s) => s.id === squadId)?.domains.join(', ') || 'nenhum domínio'}`}>
              {sq?.squads.map((s) => <MenuItem key={s.id} value={s.id}>{s.name} · {s.domains.length} domínios</MenuItem>)}
            </TextField>
          ) : <Typography variant="caption">{ROLE_HELP[f.role]}</Typography>}
          {err && <Alert severity="error" variant="outlined">{err}</Alert>}
          <Button variant="contained" onClick={submit} disabled={create.isPending}>{create.isPending ? 'Criando…' : 'Criar usuário e enviar convite'}</Button>
        </Stack></CardContent></Card>
      </Grid>
      <Dialog open={!!created} onClose={() => setCreated(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Usuário criado<Typography variant="caption" component="div">{inviteSent ? 'O servidor enviou o convite por e-mail' : 'O convite NÃO foi enviado'}</Typography></DialogTitle>
        <DialogContent>
          {!inviteSent && <Alert severity="warning" variant="outlined" sx={{ mb: 1.5 }}>O servidor não conseguiu enviar o e-mail (SMTP não configurado ou fora do ar). Configure o SMTP e use “Reenviar convite” na lista de usuários.</Alert>}
          {created && (
            <Box sx={{ bgcolor: '#f5f7fb', color: '#1c2536', borderRadius: 2.5, p: 2.5, fontSize: 14, lineHeight: 1.6 }}>
              <Box sx={{ fontSize: 12, color: '#5b6679', borderBottom: '1px solid #dde3ec', pb: 1.25, mb: 1.5, display: 'grid', gap: 0.25 }}>
                <span><b>De:</b> Pluto Mídia &lt;admin@plutomidia.com.br&gt;</span><span><b>Para:</b> {created.email}</span><span><b>Assunto:</b> Seu acesso ao Pluto Mídia</span>
              </Box>
              <p style={{ margin: '0 0 10px' }}>Olá {created.name.split(' ')[0]},</p><p style={{ margin: '0 0 10px' }}>Seu acesso ao Pluto Mídia foi criado.</p>
              <p style={{ margin: 0 }}>Login: <b>{created.email}</b><br />Senha temporária: <b>enviada neste e-mail</b></p>
              <p style={{ margin: '10px 0 0', fontSize: 13, color: '#5b6679' }}>Por segurança, altere sua senha no primeiro acesso.</p>
            </Box>
          )}
          <Typography variant="caption" component="p" sx={{ mt: 1.5 }}>A senha temporária é gerada e enviada só pelo servidor. O front nunca vê a senha.</Typography>
        </DialogContent>
        <DialogActions><Button variant="contained" onClick={() => setCreated(null)}>Fechar</Button></DialogActions>
      </Dialog>
      {edit && <UserDialog key={edit.id} u={edit} self={edit.id === me?.id} onClose={() => setEdit(null)} />}
      <ConfirmDialog open={!!del} title="Excluir usuário?" busy={remove.isPending} onClose={() => { setDel(null); remove.reset(); }} onConfirm={() => del && remove.mutate(del.id, { onSuccess: () => setDel(null) })}>
        <b>{del?.name}</b> ({del?.email}) perde o acesso na hora e todas as sessões dele são encerradas. Para só bloquear, edite e escolha <b>Desativado</b>.
        {remove.error && <Alert severity="error" variant="outlined" sx={{ mt: 1.5 }}>{remove.error instanceof ApiError ? remove.error.message : 'Não foi possível excluir.'}</Alert>}
      </ConfirmDialog>
      <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast('')} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Grid>
  );
}

function UserDialog({ u, self, onClose }: { u: User; self: boolean; onClose: () => void }) {
  const { data: sq } = useSquads();
  const { isSuperAdmin } = useAuth();
  const [f, setF] = useState<Required<UpdateUserRequest>>({ name: u.name, role: u.role, squadId: u.squadId, status: u.status === 'disabled' ? 'disabled' : 'active' });
  const [err, setErr] = useState('');
  const save = useAdminMutation((b: UpdateUserRequest) => adminApi.updateUser(u.id, b), [qk.users, qk.squads]);
  const submit = () => {
    if (!f.name.trim()) return setErr('Digite o nome.');
    if (f.role === 'gestor' && !f.squadId) return setErr('Escolha o Squad do gestor.');
    setErr('');
    const body: UpdateUserRequest = { name: f.name.trim(), role: f.role, squadId: f.role === 'gestor' ? f.squadId : null };
    if (u.status !== 'invited') body.status = f.status;
    save.mutate(body, { onSuccess: onClose, onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.') });
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Editar usuário<Typography variant="caption" component="div">{u.email}</Typography></DialogTitle>
      <DialogContent><Stack spacing={1.75} sx={{ pt: 1 }}>
        <TextField label="Nome" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} fullWidth />
        <TextField select label="Permissão" value={f.role} disabled={self} helperText={self ? 'Você não pode mudar a sua própria permissão.' : undefined} onChange={(e) => setF({ ...f, role: e.target.value as Role, squadId: e.target.value === 'gestor' ? f.squadId ?? sq?.squads[0]?.id ?? null : null })} fullWidth>
          <MenuItem value="gestor">Gestor</MenuItem><MenuItem value="admin">Admin</MenuItem>{(isSuperAdmin || u.role === 'superadmin') && <MenuItem value="superadmin" disabled={!isSuperAdmin}>SuperAdmin</MenuItem>}
        </TextField>
        <Typography variant="caption" sx={{ mt: -0.75 }}>{ROLE_HELP[f.role]}</Typography>
        {f.role === 'gestor' && (
          <TextField select label="Squad" value={f.squadId ?? ''} onChange={(e) => setF({ ...f, squadId: e.target.value })} fullWidth>
            {sq?.squads.map((s) => <MenuItem key={s.id} value={s.id}>{s.name} · {s.domains.length} domínios</MenuItem>)}
          </TextField>
        )}
        {u.status !== 'invited' && (
          <TextField select label="Status" value={f.status} disabled={self} onChange={(e) => setF({ ...f, status: e.target.value as 'active' | 'disabled' })} fullWidth helperText="Desativado não consegue entrar, mas o usuário continua cadastrado.">
            <MenuItem value="active">Ativo</MenuItem><MenuItem value="disabled">Desativado</MenuItem>
          </TextField>
        )}
        {err && <Alert severity="error" variant="outlined">{err}</Alert>}
      </Stack></DialogContent>
      <DialogActions><Button variant="outlined" onClick={onClose}>Cancelar</Button><Button variant="contained" onClick={submit} disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button></DialogActions>
    </Dialog>
  );
}

function SquadsTab() {
  const { data, error, refetch } = useSquads();
  const { data: doms } = useAdminDomains();
  const { data: users } = useUsers();
  const [edit, setEdit] = useState<{ id?: string; name: string; domains: string[] } | null>(null);
  const save = useAdminMutation(adminApi.saveSquad, [qk.squads, qk.adminDomains]);
  const remove = useAdminMutation(adminApi.deleteSquad, [qk.squads, qk.adminDomains, qk.users]);
  const [del, setDel] = useState<{ id: string; name: string } | null>(null);
  if (error) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data) return <PageSkeleton />;
  const active = doms?.domains.filter((d) => d.active) ?? [];
  return (
    <>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.75 }}>
        <Button variant="contained" onClick={() => setEdit({ name: `Squad ${String(data.squads.length + 1).padStart(2, '0')}`, domains: [] })}>+ Criar Squad</Button>
        <Typography variant="caption">O Squad define quais domínios o gestor vê.</Typography>
      </Stack>
      <Grid container spacing={1.75}>
        {edit && (
          <Grid size={{ xs: 12, md: 6 }}><Card><CardHeader title={edit.id ? 'Editar Squad' : 'Novo Squad'} /><CardContent><Stack spacing={1.5}>
            <TextField label="Nome" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} fullWidth />
            <Typography variant="overline">Domínios</Typography>
            <FormGroup>{active.map((d) => {
              const other = data.squads.find((s) => s.id !== edit.id && s.domains.includes(d.hostname));
              return <FormControlLabel key={d.hostname} label={<>{d.hostname} {other && <Typography variant="caption" component="span">(hoje em {other.name})</Typography>}</>}
                control={<Checkbox size="small" checked={edit.domains.includes(d.hostname)} onChange={(e) => setEdit({ ...edit, domains: e.target.checked ? [...edit.domains, d.hostname] : edit.domains.filter((x) => x !== d.hostname) })} />} />;
            })}</FormGroup>
            <Stack direction="row" spacing={1}><Button variant="contained" onClick={() => save.mutate(edit, { onSuccess: () => setEdit(null) })}>Salvar</Button><Button variant="outlined" onClick={() => setEdit(null)}>Cancelar</Button></Stack>
          </Stack></CardContent></Card></Grid>
        )}
        {data.squads.filter((s) => s.id !== edit?.id).map((s) => (
          <Grid key={s.id} size={{ xs: 12, md: 6 }}><Card sx={{ height: '100%' }}>
            <CardHeader title={s.name} action={<Stack direction="row" spacing={0.5}><Button size="small" variant="outlined" onClick={() => setEdit({ id: s.id, name: s.name, domains: s.domains })}>Editar</Button><Tooltip title="Excluir Squad"><IconButton size="small" aria-label={`Excluir ${s.name}`} onClick={() => setDel(s)}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip></Stack>} />
            <CardContent><Stack spacing={1.75}>
              <Box><Typography variant="overline">Domínios</Typography><Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>{s.domains.map((d) => <Tag key={d}>{d}</Tag>)}{!s.domains.length && <Typography variant="caption">Nenhum</Typography>}</Stack></Box>
              <Box><Typography variant="overline">Gestores</Typography>{users?.users.filter((u) => u.squadId === s.id).map((u) => <Stack key={u.id} direction="row" spacing={1} sx={{ alignItems: 'center', py: 0.4 }}><Avatar sx={{ ...avatarSx, width: 24, height: 24, fontSize: 10 }}>{initials(u.name)}</Avatar><span>{u.name}</span><Typography variant="caption">{u.email}</Typography></Stack>)}</Box>
            </Stack></CardContent>
          </Card></Grid>
        ))}
      </Grid>
      <ConfirmDialog open={!!del} title="Excluir Squad?" busy={remove.isPending} onClose={() => { setDel(null); remove.reset(); }} onConfirm={() => del && remove.mutate(del.id, { onSuccess: () => setDel(null) })}>
        Os domínios de <b>{del?.name}</b> ficam sem Squad (só Admin e SuperAdmin veem). Squads com gestores não podem ser excluídos: mova os gestores antes.
        {remove.error && <Alert severity="error" variant="outlined" sx={{ mt: 1.5 }}>{remove.error instanceof ApiError ? remove.error.message : 'Não foi possível excluir.'}</Alert>}
      </ConfirmDialog>
    </>
  );
}

function PermsTab() {
  const { data, error, refetch } = usePermissions();
  const [sel, setSel] = useState<Capability[] | null>(null);
  const save = useAdminMutation(adminApi.savePermissions, [qk.permissions, qk.me]);
  useEffect(() => { if (data) setSel(data.roles.gestor); }, [data]);
  if (error) return <ErrorBox error={error} retry={() => refetch()} />;
  if (!data || !sel) return <PageSkeleton />;
  const dirty = JSON.stringify([...sel].sort()) !== JSON.stringify([...data.roles.gestor].sort());
  const groups = ['Visualização', 'Administração'] as const;
  return (
    <>
      <TableContainer component={Card}><Table>
        <TableHead><TableRow><TableCell>Permissão</TableCell><TableCell align="center">Gestor</TableCell><TableCell align="center">Admin</TableCell><TableCell align="center">SuperAdmin</TableCell></TableRow></TableHead>
        <TableBody>
          <TableRow><TableCell>Dashboard e Domínios</TableCell>{[0, 1, 2].map((i) => <TableCell key={i} align="center"><Checkbox size="small" checked disabled /></TableCell>)}</TableRow>
          <TableRow><TableCell>Vê só os domínios do próprio Squad <LockOutlinedIcon sx={{ fontSize: 14, verticalAlign: -2, color: 'text.disabled' }} /></TableCell><TableCell align="center"><Checkbox size="small" checked disabled /></TableCell><TableCell align="center"><Checkbox size="small" disabled /></TableCell><TableCell align="center"><Checkbox size="small" disabled /></TableCell></TableRow>
          {groups.map((g) => [
            <TableRow key={g}><TableCell colSpan={4} sx={{ bgcolor: 'action.hover', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'text.secondary' }}>{g}</TableCell></TableRow>,
            ...data.capabilities.filter((c) => c.group === g).map((c) => (
              <TableRow key={c.key}>
                <TableCell>{c.label}{c.adminOnly && <Tooltip title={c.superAdminOnly ? 'Só SuperAdmin' : 'Por segurança, só Admin e SuperAdmin'}><LockOutlinedIcon sx={{ fontSize: 14, verticalAlign: -2, ml: 0.75, color: 'text.disabled' }} /></Tooltip>}</TableCell>
                <TableCell align="center"><Checkbox size="small" disabled={c.adminOnly} checked={!c.adminOnly && sel.includes(c.key)} onChange={(e) => setSel(e.target.checked ? [...sel, c.key] : sel.filter((x) => x !== c.key))} slotProps={{ input: { 'aria-label': `Gestor: ${c.label}` } }} /></TableCell>
                <TableCell align="center"><Checkbox size="small" checked={data.roles.admin.includes(c.key)} disabled /></TableCell>
                <TableCell align="center"><Checkbox size="small" checked disabled /></TableCell>
              </TableRow>
            )),
          ])}
        </TableBody>
      </Table></TableContainer>
      <Stack direction="row" spacing={1} sx={{ mt: 1.75, alignItems: 'center' }}>
        <Button variant="contained" disabled={!dirty || save.isPending} onClick={() => save.mutate(sel)}>{save.isPending ? 'Salvando…' : 'Salvar permissões'}</Button>
        <Button variant="outlined" disabled={!dirty} onClick={() => setSel(data.roles.gestor)}>Desfazer</Button>
        {save.isSuccess && !dirty && <Typography variant="caption">Salvo. Vale no próximo carregamento de cada gestor.</Typography>}
      </Stack>
      <Alert severity="info" variant="outlined" sx={{ mt: 1.75 }}>A restrição por Squad e as permissões são aplicadas no servidor em toda consulta. Um gestor não vê outro domínio nem um módulo desligado mudando a URL ou chamando a API direto.</Alert>
    </>
  );
}
