import { Alert, Box, Button, Card, Divider, Stack, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { authApi } from '@/lib/api/endpoints';
import { ApiError, IS_MOCK } from '@/lib/api/client';
import { Logo } from '@/components/ui/Logo';

type View = 'login' | 'forgot' | 'change' | 'reset';
/** Mesma regra do servidor: 10+ caracteres, com letras e números. */
const weak = (p: string) => p.length < 10 || !/[A-Za-z]/.test(p) || !/\d/.test(p);

export default function LoginPage() {
  const [params] = useSearchParams();
  const resetToken = params.get('reset');
  const [view, setView] = useState<View>(resetToken ? 'reset' : params.get('change') ? 'change' : 'login');
  const [done, setDone] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const { login, refresh } = useAuth();
  const navigate = useNavigate();
  const run = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await fn(); } catch (x) { setErr(x instanceof ApiError ? x.message : 'Algo deu errado.'); } finally { setBusy(false); }
  };
  const submitLogin = run(async () => { const u = await login(email, pw); if (u.mustChangePassword) setView('change'); else navigate('/', { replace: true }); });
  const submitForgot = run(async () => { await authApi.forgot(email); setSent(true); });
  const submitChange = run(async () => {
    if (weak(pw)) throw new ApiError(0, 'v', 'A senha precisa de 10 caracteres ou mais, com letras e números.');
    if (pw !== pw2) throw new ApiError(0, 'v', 'As senhas não conferem.');
    await authApi.changePassword(null, pw); await refresh(); navigate('/', { replace: true });
  });
  const submitReset = run(async () => {
    if (weak(pw)) throw new ApiError(0, 'v', 'A senha precisa de 10 caracteres ou mais, com letras e números.');
    if (pw !== pw2) throw new ApiError(0, 'v', 'As senhas não conferem.');
    await authApi.resetPassword(resetToken ?? '', pw);
    setPw(''); setPw2(''); setView('login'); setDone('Senha criada. Entre com o seu e-mail e a nova senha.'); navigate('/login', { replace: true });
  });

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', px: 2, py: 4 }}>
      <Card component="form" onSubmit={view === 'login' ? submitLogin : view === 'forgot' ? submitForgot : view === 'reset' ? submitReset : submitChange} sx={{ width: 'min(410px, 100%)', p: 3.5 }}>
        <Stack spacing={2.25}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }} ><Logo /><Box><Typography sx={{ fontFamily: 'Sora', fontWeight: 700, fontSize: 16.5 }}>Pluto Mídia</Typography><Typography variant="caption">Media Intelligence</Typography></Box></Stack>
          {view === 'login' && (<>
            <TextField label="E-mail ou usuário" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required fullWidth />
            <TextField label="Senha" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required fullWidth />
          </>)}
          {view === 'forgot' && (<>
            <Box><Typography variant="h1" sx={{ fontSize: 20 }}>Esqueci minha senha</Typography><Typography color="text.secondary" sx={{ mt: 0.75 }}>Se o e-mail estiver cadastrado, enviamos um link para criar uma nova senha.</Typography></Box>
            <TextField label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required fullWidth />
            {sent && <Alert severity="info" variant="outlined">Se {email} estiver cadastrado, o link chega em alguns minutos.</Alert>}
          </>)}
          {done && view === 'login' && <Alert severity="success" variant="outlined">{done}</Alert>}
          {(view === 'change' || view === 'reset') && (<>
            <Box><Typography variant="h1" sx={{ fontSize: 20 }}>{view === 'reset' ? 'Nova senha' : 'Crie sua senha'}</Typography><Typography color="text.secondary" sx={{ mt: 0.75 }}>{view === 'reset' ? 'Escolha uma senha nova para a sua conta.' : 'Por segurança, troque a senha temporária no primeiro acesso.'}</Typography></Box>
            <TextField label="Nova senha (10+ caracteres, letras e números)" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required fullWidth />
            <TextField label="Repita a nova senha" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required fullWidth />
          </>)}
          {err && <Alert severity="error" variant="outlined">{err}</Alert>}
          <Button type="submit" variant="contained" size="large" disabled={busy}>{view === 'login' ? (busy ? 'Entrando…' : 'Entrar') : view === 'forgot' ? 'Enviar link' : view === 'reset' ? 'Salvar nova senha' : 'Salvar e entrar'}</Button>
          {view === 'login' ? <Button onClick={() => setView('forgot')}>Esqueci minha senha</Button> : view === 'forgot' && <Button onClick={() => { setView('login'); setSent(false); }}>Voltar para o login</Button>}
          {IS_MOCK && view === 'login' && (<>
            <Divider />
            <Typography variant="overline">Modo demonstração (mock)</Typography>
            <Button variant="outlined" onClick={() => { setEmail('admin@exemplo.com'); setPw('admin123'); }} sx={{ justifyContent: 'space-between' }}>Acesso Total<Typography variant="caption">admin@exemplo.com · admin123</Typography></Button>
            <Button variant="outlined" onClick={() => { setEmail('gestor@exemplo.com'); setPw('gestor123'); }} sx={{ justifyContent: 'space-between' }}>Gestor · Squad 01<Typography variant="caption">gestor@exemplo.com · gestor123</Typography></Button>
          </>)}
        </Stack>
      </Card>
    </Box>
  );
}
