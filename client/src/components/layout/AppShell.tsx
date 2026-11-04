import { BottomNavigation, BottomNavigationAction, Box, Drawer, useMediaQuery, useTheme } from '@mui/material';
import SpaceDashboardOutlinedIcon from '@mui/icons-material/SpaceDashboardOutlined';
import LanguageOutlinedIcon from '@mui/icons-material/LanguageOutlined';
import GoogleIcon from '@mui/icons-material/Google';
import FacebookRoundedIcon from '@mui/icons-material/FacebookRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { usePrefs } from '@/context/PrefsContext';
import { PageSkeleton } from '@/components/ui/States';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { isActive } from './nav';

const FULL = 236, MINI = 72;
const TABS = [{ to: '/', label: 'Início', icon: <SpaceDashboardOutlinedIcon /> }, { to: '/dominios', label: 'Domínios', icon: <LanguageOutlinedIcon /> }, { to: '/google-ads', label: 'Google', icon: <GoogleIcon /> }, { to: '/meta-ads', label: 'Meta', icon: <FacebookRoundedIcon /> }];

/** Moldura das telas logadas + proteção de rota (sem login → /login). */
export function AppShell() {
  const { user, loading } = useAuth();
  const { prefs } = usePrefs();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => { setNavOpen(false); window.scrollTo(0, 0); }, [pathname]);

  if (!loading && !user) return <Navigate to="/login" replace />;
  if (!loading && user?.mustChangePassword) return <Navigate to="/login?change=1" replace />;
  const w = mobile ? 0 : prefs.sideMini ? MINI : FULL;
  const paper = { width: mobile ? 272 : w, bgcolor: theme.pluto.side, backgroundImage: 'linear-gradient(180deg,#0d1b36,#0b172f)', borderRight: `1px solid ${theme.pluto.line}`, transition: 'width .18s', overflowX: 'hidden' };
  const showFilters = !(pathname.startsWith('/admin') && pathname !== '/admin/moedas');
  const tab = TABS.findIndex((t) => isActive(pathname, t.to));
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {mobile
        ? <Drawer variant="temporary" open={navOpen} onClose={() => setNavOpen(false)} slotProps={{ paper: { sx: paper } }}><Sidebar mini={false} onNavigate={() => setNavOpen(false)} /></Drawer>
        : <Drawer variant="permanent" sx={{ width: w, flexShrink: 0, transition: 'width .18s' }} slotProps={{ paper: { sx: paper } }}><Sidebar mini={!!prefs.sideMini} /></Drawer>}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Topbar showFilters={showFilters} />
        <Box component="main" sx={{ px: { xs: 1.75, md: 3 }, pt: { xs: 2, md: 2.75 }, pb: { xs: 12, md: 7.5 }, maxWidth: 1560, '& .MuiTableCell-root': prefs.dense ? { py: 0.75, px: 1.25, fontSize: 12.5 } : undefined }}>
          {loading || !user ? <PageSkeleton /> : <Outlet />}
        </Box>
      </Box>
      {mobile && (
        <BottomNavigation showLabels value={navOpen ? 4 : tab} sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: theme.zIndex.appBar + 1, pb: 'env(safe-area-inset-bottom)', backdropFilter: 'blur(12px)' }}
          onChange={(_, v: number) => (v === 4 ? setNavOpen(!navOpen) : navigate(TABS[v].to))}>
          {TABS.map((t) => <BottomNavigationAction key={t.to} label={t.label} icon={t.icon} />)}
          <BottomNavigationAction label="Menu" icon={<MenuRoundedIcon />} />
        </BottomNavigation>
      )}
    </Box>
  );
}
