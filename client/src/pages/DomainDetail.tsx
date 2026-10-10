import { Box, Button, Card, Link, Stack, TextField, Typography } from '@mui/material';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import { useMemo, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useFilters } from '@/context/FiltersContext';
import { useDomain } from '@/hooks/queries';
import { KpiRow } from '@/components/dashboard/KpiRow';
import { CampaignTable } from '@/components/campaigns/CampaignTable';
import { MetricPicker } from '@/components/ui/MetricPicker';
import { ErrorBox, NoAccess, PageHead, PageSkeleton, Provisional } from '@/components/ui/States';
import { ApiError } from '@/lib/api/client';
import { domainLabel, longDate } from '@/lib/format';
import { addDays, todayISO } from '@/lib/period';

export default function DomainDetailPage() {
  const domain = decodeURIComponent(useParams().domain ?? '');
  const f = useFilters();
  const [q, setQ] = useState('');
  const { data, error, isLoading, refetch } = useDomain(domain);
  const list = useMemo(() => (data?.campaigns ?? []).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase())), [data, q]);
  if (error instanceof ApiError && error.status === 403) return <NoAccess msg="Este domínio não faz parte do seu Squad." />;
  return (
    <>
      <PageHead title={domainLabel(domain)} sub={`${longDate(f.from)} – ${longDate(f.to)}`} crumb={<Link component={RouterLink} to="/dominios" color="inherit">Domínios / Sites</Link>}
        right={<Button variant="outlined" startIcon={<LinkRoundedIcon />} component={RouterLink} to={`/urls?domain=${encodeURIComponent(domain)}`}>URLs deste domínio</Button>} />
      <Provisional show={f.to >= addDays(todayISO(), -3)} />
      {isLoading && !data ? <PageSkeleton /> : error && !data ? <ErrorBox error={error} retry={() => refetch()} /> : data && (
        <>
          <KpiRow m={data.metrics} cmp={data.comparison} />
          <Card sx={{ mt: 1.75 }}>
            <Stack direction="row" spacing={1.25} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', p: 1.75, borderBottom: 1, borderColor: 'divider' }}>
              <Typography variant="h2">Campanhas</Typography>
              <TextField size="small" placeholder="Pesquisar campanha" value={q} onChange={(e) => setQ(e.target.value)} sx={{ width: 220 }} />
              <Box sx={{ flex: 1 }} /><MetricPicker screen="domain" />
            </Stack>
            <CampaignTable screen="domain" campaigns={list} totals={data.campaignTotals} totalsRoiDays={data.campaignTotalsRoiDays} showDomain={false} showPlatform />
          </Card>
        </>
      )}
    </>
  );
}
