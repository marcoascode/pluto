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
import TrackChangesRoundedIcon from '@mui/icons-material/TrackChangesRounded';
import AccountBalanceOutlinedIcon from '@mui/icons-material/AccountBalanceOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import ManageAccountsOutlinedIcon from '@mui/icons-material/ManageAccountsOutlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import CreditCardOutlinedIcon from '@mui/icons-material/CreditCardOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';

export interface NavItem { to: string; label: string; icon: ReactElement; cap?: Capability; manager?: boolean; metaCampaigns?: boolean; /** 0.18.14: só com a flag do Fluxo de caixa */ cashflow?: boolean; /** 0.18.9: só para o Gerente (o Admin acessa pelo menu Administração) */ gerente?: boolean }
/* 0.18.12 · ordem do menu: Dashboard, Relatórios · Campanhas · Domínios · Monetização · Atribuição · Administração */
export const NAV_MAIN: { title: string | null; items: NavItem[] }[] = [
  { title: null, items: [{ to: '/', label: 'Dashboard', icon: <SpaceDashboardOutlinedIcon /> }, { to: '/relatorios', label: 'Relatórios', icon: <TableChartOutlinedIcon />, cap: 'reports.view' }] },
  { title: 'Campanhas', items: [
    { to: '/google-ads', label: 'Google Ads', icon: <GoogleIcon />, cap: 'campaigns.google.view' },
    { to: '/placements', label: 'Placements', icon: <TrackChangesRoundedIcon />, cap: 'campaigns.google.view' },
    { to: '/meta-ads', label: 'Meta Ads', icon: <FacebookRoundedIcon />, cap: 'campaigns.meta.view' },
    { to: '/perfis-meta', label: 'Perfis & BMs', icon: <ManageAccountsOutlinedIcon />, metaCampaigns: true },
    { to: '/criar-campanha-meta', label: 'Criar campanhas Meta', icon: <AutoAwesomeOutlinedIcon />, metaCampaigns: true },
  ] },
  { title: 'Domínios', items: [
    { to: '/dominios', label: 'Domínios / Sites', icon: <LanguageOutlinedIcon /> },
    { to: '/vinculos', label: 'Contas × Sites', icon: <HubOutlinedIcon /> },
    { to: '/urls', label: 'URLs', icon: <LinkRoundedIcon />, cap: 'urls.view' },
    { to: '/admin/usuarios', label: 'Gestores', icon: <GroupsOutlinedIcon />, gerente: true },
  ] },
  { title: 'Monetização', items: [{ to: '/ad-manager', label: 'Google Ad Manager', icon: <PaidOutlinedIcon />, cap: 'gam.view' }] },
  { title: 'Fluxo de caixa', items: [
    { to: '/fluxo-caixa', label: 'Fluxo de caixa', icon: <CreditCardOutlinedIcon />, cashflow: true },
    { to: '/faturas', label: 'Faturas (PDF)', icon: <UploadFileOutlinedIcon />, cashflow: true },
  ] },
  { title: 'Atribuição', items: [
    { to: '/atribuicao', label: 'Diagnóstico da atribuição', icon: <MonitorHeartOutlinedIcon />, cap: 'attribution.view' },
    { to: '/utm-debugger', label: 'UTM Debugger', icon: <BugReportOutlinedIcon />, cap: 'utm.debug' },
  ] },
];
/**
 * Administração. `finance`: grupo Finanças — Admin/SuperAdmin e sócios das Empresas (`manager`: também o Gestor com
 * site vinculado, só a própria comissão). Os demais grupos: só Admin e SuperAdmin (o servidor também bloqueia /admin/* com 403).
 */
export const NAV_ADMIN: { title: string; finance?: boolean; items: NavItem[] }[] = [
  { title: 'Finanças', finance: true, items: [
    { to: '/finance/caixa', label: 'Caixa Empresa', icon: <AccountBalanceOutlinedIcon /> },
    { to: '/finance/custos', label: 'Custos', icon: <ReceiptLongOutlinedIcon /> },
    { to: '/finance/comissoes', label: 'Comissões', icon: <EmojiEventsOutlinedIcon />, manager: true },
  ] },
  { title: 'Relatórios', items: [
    { to: '/admin/relatorios/google-ads', label: 'Google Ads', icon: <AssessmentOutlinedIcon /> },
    { to: '/admin/relatorios/meta-ads', label: 'Meta Ads', icon: <AssessmentOutlinedIcon /> },
    { to: '/admin/relatorios/ad-manager', label: 'Google Ad Manager', icon: <AssessmentOutlinedIcon /> },
  ] },
  { title: 'Integrações', items: [
    { to: '/admin/integracoes/google-ads', label: 'Google Ads', icon: <PowerOutlinedIcon /> },
    { to: '/admin/integracoes/meta-ads', label: 'Meta Ads', icon: <PowerOutlinedIcon /> },
    { to: '/admin/integracoes/ad-manager', label: 'Google Ad Manager', icon: <PowerOutlinedIcon /> },
  ] },
  { title: 'Configurações', items: [
    { to: '/admin/contas', label: 'Contas', icon: <AccountBalanceWalletOutlinedIcon /> },
    { to: '/admin/dominios', label: 'Domínios', icon: <PublicOutlinedIcon /> },
    { to: '/admin/usuarios', label: 'Usuários & Squads', icon: <GroupsOutlinedIcon /> },
    { to: '/admin/utms', label: 'Atribuição / UTMs', icon: <SellOutlinedIcon /> },
    { to: '/admin/moedas', label: 'Moedas', icon: <CurrencyExchangeOutlinedIcon /> },
  ] },
];
export const isActive = (path: string, to: string) => (to === '/' ? path === '/' : path === to || path.startsWith(to + '/'));
