import { Avatar, Box, Collapse, IconButton, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader, Stack, Tooltip, Typography } from '@mui/material';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { usePrefs } from '@/context/PrefsContext';
import { initials } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/roles';
import { Logo } from '@/components/ui/Logo';
import { NAV_ADMIN, NAV_FINANCE, NAV_MAIN, isActive, type NavItem } from './nav';
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined';

const Head = ({ children, mini }: { children: string; mini: boolean }) => (mini ? null : <ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: '28px', mt: 1.5, fontSize: 10.5, letterSpacing: '.09em', textTransform: 'uppercase', fontWeight: 600, color: 'text.disabled', px: 1.25 }}>{children}</ListSubheader>);

export function Sidebar({ mini, onNavigate }: { mini: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const { user, isAdmin, canFinance, can, canMetaCampaigns } = useAuth();
  const { prefs, update } = usePrefs();
  const [adminOpen, setAdminOpen] = useState(true);
  const open = adminOpen || pathname.startsWith('/admin');
  const [finOpen, setFinOpen] = useState(() => pathname.startsWith('/finance'));
  const fin = finOpen || pathname.startsWith('/finance');
  const item = (it: NavItem) => (
    <Tooltip key={it.to} title={mini ? it.label : ''} placement="right">
      <ListItemButton component={NavLink} to={it.to} selected={isActive(pathname, it.to)} onClick={onNavigate} sx={{ mb: 0.25, justifyContent: mini ? 'center' : 'flex-start' }}>
        <ListItemIcon>{it.icon}</ListItemIcon>{!mini && <ListItemText primary={it.label} slotProps={{ primary: { sx: { fontSize: 13.5 } } }} />}
      </ListItemButton>
    </Tooltip>
  );
  return (
    <Stack sx={{ height: '100%' }}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', justifyContent: mini ? 'center' : 'flex-start', px: mini ? 0 : 2.25, pt: 2.25, pb: 1.75 }}>
        <Logo />
        {!mini && <Box><Typography sx={{ fontFamily: 'Sora', fontWeight: 700, fontSize: 16.5, lineHeight: 1.2 }}>Pluto Mídia</Typography><Typography variant="caption" sx={{ fontSize: 10.5 }}>Media Intelligence</Typography></Box>}
      </Stack>
      <List sx={{ flex: 1, overflowY: 'auto', px: 1.25, pt: 0 }}>
        {NAV_MAIN.map((g) => ({ ...g, items: g.items.filter((it) => (!it.cap || can(it.cap)) && (!it.metaCampaigns || canMetaCampaigns)) })).filter((g) => g.items.length).map((g, i) => <Box key={i}>{g.title && <Head mini={mini}>{g.title}</Head>}{g.items.map(item)}</Box>)}
        {/* Finance: clica e abre Caixa Empresa e Custos */}
        {(canFinance || user?.role === 'gestor') && (
          <>
            <Head mini={mini}>Finance</Head>
            <Tooltip title={mini ? 'Finance' : ''} placement="right">
              <ListItemButton onClick={() => setFinOpen(!fin)} aria-expanded={fin} selected={!fin && pathname.startsWith('/finance')} sx={{ mb: 0.25, justifyContent: mini ? 'center' : 'flex-start' }}>
                <ListItemIcon><SavingsOutlinedIcon /></ListItemIcon>
                {!mini && <ListItemText primary="Finance" slotProps={{ primary: { sx: { fontSize: 13.5 } } }} />}
                {!mini && <ExpandMoreRoundedIcon fontSize="small" sx={{ transform: fin ? 'none' : 'rotate(-90deg)', transition: '.15s', color: 'text.disabled' }} />}
              </ListItemButton>
            </Tooltip>
            <Collapse in={fin}><Box sx={{ pl: mini ? 0 : 1.5 }}>{NAV_FINANCE.filter((it) => canFinance || it.manager).map(item)}</Box></Collapse>
          </>
        )}
        {isAdmin && (
          <>
            <ListItemButton onClick={() => setAdminOpen(!open)} sx={{ mt: 1.5, justifyContent: mini ? 'center' : 'space-between' }} aria-expanded={open}>
              {!mini && <Typography sx={{ fontSize: 10.5, letterSpacing: '.09em', textTransform: 'uppercase', fontWeight: 600, color: 'text.disabled' }}>Administração</Typography>}
              <ExpandMoreRoundedIcon fontSize="small" sx={{ transform: open ? 'none' : 'rotate(-90deg)', transition: '.15s', color: 'text.disabled' }} />
            </ListItemButton>
            <Collapse in={open}>{NAV_ADMIN.map((g) => <Box key={g.title}>{!mini && <Typography variant="caption" component="div" sx={{ px: 1.25, mt: 1, mb: 0.25, fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.75 }}>{g.title}</Typography>}{g.items.map(item)}</Box>)}</Collapse>
          </>
        )}
      </List>
      {user && (
        <Stack direction={mini ? 'column' : 'row'} spacing={1.25} sx={{ alignItems: 'center', borderTop: 1, borderColor: 'divider', p: 1.5 }}>
          <Avatar sx={{ width: 30, height: 30, fontSize: 12, fontWeight: 600, background: 'linear-gradient(135deg,#2f6fe0,#1b3f86)', color: '#fff' }}>{initials(user.name)}</Avatar>
          {!mini && <Box sx={{ flex: 1, minWidth: 0 }}><Typography noWrap sx={{ fontSize: 12.5 }}>{user.name}</Typography><Typography variant="caption" noWrap component="div">{ROLE_LABEL[user.role] ?? user.role}</Typography></Box>}
          {onNavigate === undefined && <IconButton size="small" onClick={() => update({ sideMini: !prefs.sideMini })} aria-label={mini ? 'Expandir menu' : 'Recolher menu'}>{mini ? <ChevronRightRoundedIcon fontSize="small" /> : <ChevronLeftRoundedIcon fontSize="small" />}</IconButton>}
        </Stack>
      )}
    </Stack>
  );
}
