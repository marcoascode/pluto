import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/layout/AppShell';
import { NoAccess, PageSkeleton } from '@/components/ui/States';
import type { Capability } from '@/types/api';

// Cada tela vira um arquivo JS separado (carrega só quando abre).
const Login = lazy(() => import('@/pages/Login'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Reports = lazy(() => import('@/pages/Reports'));
const Domains = lazy(() => import('@/pages/Domains'));
const DomainDetail = lazy(() => import('@/pages/DomainDetail'));
const Urls = lazy(() => import('@/pages/Urls'));
const Campaigns = lazy(() => import('@/components/campaigns/CampaignsView').then((m) => ({ default: m.CampaignsView })));
const AdManager = lazy(() => import('@/pages/AdManager'));
const Links = lazy(() => import('@/pages/Links'));
const Placements = lazy(() => import('@/pages/Placements'));
const CompanyOverview = lazy(() => import('@/pages/CompanyOverview'));
const AttributionHealth = lazy(() => import('@/pages/AttributionHealth'));
const UtmDebugger = lazy(() => import('@/pages/UtmDebugger'));
const Accounts = lazy(() => import('@/pages/admin/Accounts'));
const AdminDomains = lazy(() => import('@/pages/admin/AdminDomains'));
const Utms = lazy(() => import('@/pages/admin/Utms'));
const Currency = lazy(() => import('@/pages/admin/Currency'));
const UsersSquads = lazy(() => import('@/pages/admin/UsersSquads'));
const IntegrationGoogle = lazy(() => import('@/pages/admin/IntegrationGoogle'));
const IntegrationMeta = lazy(() => import('@/pages/admin/IntegrationMeta'));
const IntegrationGam = lazy(() => import('@/pages/admin/IntegrationGam'));
const MetaProfiles = lazy(() => import('@/pages/meta/MetaProfiles'));
const MetaCampaignWizard = lazy(() => import('@/pages/meta/MetaCampaignWizard'));
const FinanceCash = lazy(() => import('@/pages/finance/Cash'));
const FinanceCosts = lazy(() => import('@/pages/finance/Costs'));
const FinanceCommissions = lazy(() => import('@/pages/finance/Commissions'));

/** Esconde as telas de admin do Gestor. O servidor também responde 403 em /admin/*. */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return isAdmin ? <>{children}</> : <NoAccess msg="Esta área é exclusiva de Admin e SuperAdmin." />;
}
/** Módulo desligado para o Gestor em Permissões. O servidor responde 403 nas rotas dele. */
function RequireCap({ cap, children }: { cap: Capability; children: ReactNode }) {
  const { can } = useAuth();
  return can(cap) ? <>{children}</> : <NoAccess msg="Este módulo não está liberado para o seu usuário." />;
}
/** 0.18: criação automatizada de campanhas Meta — só com a flag atribuída pelo SuperAdmin. O servidor também responde 403. */
function RequireMetaCampaigns({ children }: { children: ReactNode }) {
  const { canMetaCampaigns } = useAuth();
  return canMetaCampaigns ? <>{children}</> : <NoAccess msg="A criação automatizada de campanhas Meta não está liberada para o seu usuário. Peça a um SuperAdmin." />;
}
/** Finance: Admin/SuperAdmin e sócios das Empresas. O servidor também responde 403. */
function RequireFinance({ children }: { children: ReactNode }) {
  const { canFinance } = useAuth();
  return canFinance ? <>{children}</> : <NoAccess msg="O Finance é só para Admin e sócios das Empresas." />;
}
const S = (el: ReactNode) => <Suspense fallback={<PageSkeleton />}>{el}</Suspense>;
const F = (el: ReactNode) => S(<RequireFinance>{el}</RequireFinance>);
const C = (cap: Capability, el: ReactNode) => S(<RequireCap cap={cap}>{el}</RequireCap>);
const M = (el: ReactNode) => S(<RequireMetaCampaigns>{el}</RequireMetaCampaigns>);
const A = (el: ReactNode) => S(<RequireAdmin>{el}</RequireAdmin>);

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={S(<Login />)} />
      <Route element={<AppShell />}>
        <Route index element={S(<Dashboard />)} />
        <Route path="relatorios" element={C('reports.view', <Reports />)} />
        <Route path="dominios" element={S(<Domains />)} />
        <Route path="dominios/:domain" element={S(<DomainDetail />)} />
        <Route path="urls" element={C('urls.view', <Urls />)} />
        {/* 0.17: Contas × Sites — Gestor (só o que é dele), Gerente, Admin, SuperAdmin; o servidor filtra */}
        <Route path="vinculos" element={S(<Links />)} />
        <Route path="google-ads" element={C('campaigns.google.view', <Campaigns key="google" platform="google" />)} />
        <Route path="meta-ads" element={C('campaigns.meta.view', <Campaigns key="meta" platform="meta" />)} />
        <Route path="criar-campanha-meta" element={M(<MetaCampaignWizard />)} />
        <Route path="perfis-meta" element={M(<MetaProfiles />)} />
        <Route path="empresas/:id" element={S(<CompanyOverview />)} />
        <Route path="placements" element={C('campaigns.google.view', <Placements />)} />
        <Route path="ad-manager" element={C('gam.view', <AdManager />)} />
        <Route path="atribuicao" element={C('attribution.view', <AttributionHealth />)} />
        <Route path="utm-debugger" element={C('utm.debug', <UtmDebugger />)} />
        <Route path="finance">
          <Route index element={<Navigate to="caixa" replace />} />
          <Route path="caixa" element={F(<FinanceCash />)} />
          <Route path="custos" element={F(<FinanceCosts />)} />
          {/* Comissões: também o Gestor com site vinculado (o servidor só devolve os sites dele) */}
          <Route path="comissoes" element={S(<FinanceCommissions />)} />
        </Route>
        <Route path="admin">
          <Route path="contas" element={A(<Accounts />)} />
          <Route path="dominios" element={A(<AdminDomains />)} />
          <Route path="utms" element={A(<Utms />)} />
          <Route path="moedas" element={A(<Currency />)} />
          <Route path="usuarios" element={A(<UsersSquads />)} />
          <Route path="integracoes/google-ads" element={A(<IntegrationGoogle />)} />
          <Route path="integracoes/meta-ads" element={A(<IntegrationMeta />)} />
          <Route path="integracoes/ad-manager" element={A(<IntegrationGam />)} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
