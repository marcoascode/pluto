import type { ReactElement } from 'react';
import type { Capability } from '@/types/api';
import SpaceDashboardOutlinedIcon from '@mui/icons-material/SpaceDashboardOutlined';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import LanguageOutlinedIcon from '@mui/icons-material/LanguageOutlined';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import GoogleIcon from '@mui/icons-material/Google';
import FacebookRoundedIcon from '@mui/icons-material/FacebookRounded';
import PaidOutlinedIcon from '@mui/icons-material/PaidOutlined';
import MonitorHeartOutlinedIcon from '@mui/icons-material/MonitorHeartOutlined';
import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined';
import PowerOutlinedIcon from '@mui/icons-material/PowerOutlined';
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import PublicOutlinedIcon from '@mui/icons-material/PublicOutlined';
import SellOutlinedIcon from '@mui/icons-material/SellOutlined';
import CurrencyExchangeOutlinedIcon from '@mui/icons-material/CurrencyExchangeOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';

export interface NavItem { to: string; label: string; icon: ReactElement; cap?: Capability }
export const NAV_MAIN: { title: string | null; items: NavItem[] }[] = [
  { title: null, items: [{ to: '/', label: 'Dashboard', icon: <SpaceDashboardOutlinedIcon /> }, { to: '/relatorios', label: 'Relatórios', icon: <TableChartOutlinedIcon />, cap: 'reports.view' }] },
  { title: 'Domínios', items: [{ to: '/dominios', label: 'Domínios / Sites', icon: <LanguageOutlinedIcon /> }, { to: '/urls', label: 'URLs', icon: <LinkRoundedIcon />, cap: 'urls.view' }] },
  { title: 'Campanhas', items: [{ to: '/google-ads', label: 'Google Ads', icon: <GoogleIcon />, cap: 'campaigns.google.view' }, { to: '/meta-ads', label: 'Meta Ads', icon: <FacebookRoundedIcon />, cap: 'campaigns.meta.view' }] },
  { title: 'Monetização', items: [{ to: '/ad-manager', label: 'Google Ad Manager', icon: <PaidOutlinedIcon />, cap: 'gam.view' }] },
  { title: 'Atribuição', items: [{ to: '/atribuicao', label: 'Attribution Health', icon: <MonitorHeartOutlinedIcon />, cap: 'attribution.view' }, { to: '/utm-debugger', label: 'UTM Debugger', icon: <BugReportOutlinedIcon />, cap: 'utm.debug' }] },
];
/** Só Acesso Total vê. O servidor também bloqueia /admin/* com 403. */
export const NAV_ADMIN: { title: string; items: NavItem[] }[] = [
  { title: 'Integrações', items: [{ to: '/admin/integracoes/google-ads', label: 'Google Ads', icon: <PowerOutlinedIcon /> }, { to: '/admin/integracoes/meta-ads', label: 'Meta Ads', icon: <PowerOutlinedIcon /> }, { to: '/admin/integracoes/ad-manager', label: 'Google Ad Manager', icon: <PowerOutlinedIcon /> }] },
  { title: 'Configurações', items: [{ to: '/admin/contas', label: 'Contas', icon: <AccountBalanceWalletOutlinedIcon /> }, { to: '/admin/dominios', label: 'Domínios', icon: <PublicOutlinedIcon /> }, { to: '/admin/utms', label: 'Attribution / UTMs', icon: <SellOutlinedIcon /> }, { to: '/admin/moedas', label: 'Moedas', icon: <CurrencyExchangeOutlinedIcon /> }, { to: '/admin/usuarios', label: 'Usuários & Squads', icon: <GroupsOutlinedIcon /> }] },
];
export const isActive = (path: string, to: string) => (to === '/' ? path === '/' : path === to || path.startsWith(to + '/'));
