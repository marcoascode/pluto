import { AppBar, Avatar, Badge, Box, Button, Dialog, IconButton, InputAdornment, List, ListItemButton, ListItemText, Menu, MenuItem, Stack, TextField, Toolbar, Typography, useMediaQuery, useTheme } from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { usePrefs } from '@/context/PrefsContext';
import { useDashboard, useSearch } from '@/hooks/queries';
import { initials, relTime } from '@/lib/format';
import { Logo } from '@/components/ui/Logo';
import { TopFilters } from '@/components/filters/TopFilters';
import { PayoutDialog } from './PayoutDialog';

export function Topbar({ showFilters }: { showFilters: boolean }) {
  const { user, logout } = useAuth();
  const { prefs, update } = usePrefs();
  const qc = useQueryClient();
  const { data } = useDashboard();
  const mobile = useMediaQuery(useTheme().breakpoints.down('md'));
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState(false);
  const [payout, setPayout] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <AppBar position="sticky" elevation={0} sx={{ bgcolor: 'rgba(10,20,40,.82)', backdropFilter: 'blur(10px)', borderBottom: 1, borderColor: 'divider', backgroundImage: 'none' }}>
      <Toolbar sx={{ gap: 1.25, flexWrap: 'wrap', py: 1, px: { xs: 1.75, md: 3 }, minHeight: { xs: 0, md: 60 } }}>
        {mobile && <Stack component={RouterLink} to="/" direction="row" spacing={1} sx={{ alignItems: 'center', mr: 'auto', color: 'text.primary', textDecoration: 'none' }}><Logo size={28} /><Typography sx={{ fontFamily: 'Sora', fontWeight: 700, fontSize: 15 }}>Pluto Mídia</Typography></Stack>}
        {showFilters && <Box sx={{ order: { xs: 10, md: 0 }, flexBasis: { xs: '100%', md: 'auto' }, minWidth: 0 }}><TopFilters /></Box>}
        {!mobile && <Box sx={{ flex: 1 }} />}
        {mobile ? <IconButton size="small" onClick={() => setSearch(true)} aria-label="Buscar"><SearchRoundedIcon fontSize="small" /></IconButton>
          : <Button variant="outlined" size="small" startIcon={<SearchRoundedIcon />} onClick={() => setSearch(true)} sx={{ color: 'text.disabled' }}>Buscar <Typography component="kbd" variant="caption" sx={{ ml: 1, px: 0.6, border: 1, borderColor: 'divider', borderRadius: 1, fontFamily: 'IBM Plex Mono' }}>Ctrl K</Typography></Button>}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} >
          <Badge variant="dot" color="success" sx={{ '& .MuiBadge-dot': { position: 'static', transform: 'none' } }} />
          {!mobile && <Typography variant="caption" title="Última atualização">{relTime(data?.lastSyncAt ?? null)}</Typography>}
          {mobile ? <IconButton size="small" onClick={() => qc.invalidateQueries()} aria-label="Atualizar"><RefreshRoundedIcon fontSize="small" /></IconButton>
            : <Button size="small" variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={() => qc.invalidateQueries()}>Atualizar</Button>}
        </Stack>
        <IconButton onClick={(e) => setMenu(e.currentTarget)} sx={{ p: 0.25, border: 0, bgcolor: 'transparent' }} aria-label="Menu do usuário">
          <Avatar sx={{ width: 30, height: 30, fontSize: 12, fontWeight: 600, background: 'linear-gradient(135deg,#2f6fe0,#1b3f86)', color: '#fff' }}>{user ? initials(user.name) : ''}</Avatar>
        </IconButton>
        <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
          <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', mb: 0.5 }}><Typography sx={{ fontWeight: 600 }} >{user?.name}</Typography><Typography variant="caption">{user?.email}</Typography></Box>
          <MenuItem onClick={() => update({ dense: !prefs.dense })} sx={{ justifyContent: 'space-between', gap: 3 }}>Tabelas <Typography variant="caption">{prefs.dense ? 'Compacta' : 'Confortável'}</Typography></MenuItem>
          <MenuItem onClick={() => { setMenu(null); setPayout(true); }}>Dados de recebimento</MenuItem>
          <MenuItem component={RouterLink} to="/login?change=1" onClick={() => setMenu(null)}>Alterar senha</MenuItem>
          <MenuItem onClick={() => { setMenu(null); logout(); }}>Sair</MenuItem>
        </Menu>
      </Toolbar>
      <SearchDialog open={search} onClose={() => setSearch(false)} />
      <PayoutDialog open={payout} onClose={() => setPayout(false)} />
    </AppBar>
  );
}

function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const { data, isFetching } = useSearch(q);
  const navigate = useNavigate();
  const go = (to: string) => { onClose(); setQ(''); navigate(to); };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" slotProps={{ paper: { sx: { alignSelf: 'flex-start', mt: '10vh' } } }}>
      <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <TextField autoFocus fullWidth placeholder="Buscar campanha, Campaign ID ou domínio" value={q} onChange={(e) => setQ(e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon /></InputAdornment> } }} />
      </Box>
      <List sx={{ maxHeight: 380, overflow: 'auto', p: 1 }}>
        {q.trim().length < 2 && <Typography variant="caption" sx={{ p: 1.5, display: 'block' }}>Digite pelo menos 2 letras.</Typography>}
        {isFetching && <Typography variant="caption" sx={{ p: 1.5, display: 'block' }}>Buscando…</Typography>}
        {data?.results.map((r, i) => (
          <ListItemButton key={i} onClick={() => go(r.kind === 'domain' ? `/dominios/${encodeURIComponent(r.domain!)}` : r.kind === 'campaign' ? `/${r.platform === 'meta' ? 'meta-ads' : 'google-ads'}?q=${r.id}` : `/urls?domain=${r.domain}`)}>
            <ListItemText primary={r.label} secondary={`${r.kind === 'campaign' ? 'Campanha' : r.kind === 'domain' ? 'Domínio' : 'URL'}${r.sub ? ' · ' + r.sub : ''}`} />
          </ListItemButton>
        ))}
        {data && !data.results.length && <Typography variant="caption" sx={{ p: 2, display: 'block', textAlign: 'center' }}>Nada encontrado.</Typography>}
      </List>
    </Dialog>
  );
}
