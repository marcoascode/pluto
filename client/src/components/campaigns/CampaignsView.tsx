import { Box, Card, Checkbox, FormControlLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFilters } from '@/context/FiltersContext';
import { useCampaigns } from '@/hooks/queries';
import { KpiRow } from '@/components/dashboard/KpiRow';
import { MetricPicker } from '@/components/ui/MetricPicker';
import { ErrorBox, PageHead, PageSkeleton, Provisional } from '@/components/ui/States';
import { longDate } from '@/lib/format';
import { addDays, todayISO } from '@/lib/period';
import type { Platform } from '@/types/api';
import { CampaignTable } from './CampaignTable';

/** Mesma tela para Google Ads e Meta Ads. */
export function CampaignsView({ platform }: { platform: Platform }) {
  const f = useFilters();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [accountId, setAccountId] = useState('');
  const [includePaused, setIncludePaused] = useState(false);
  const { data, error, isLoading, refetch } = useCampaigns(platform, { accountId: accountId || undefined, includePaused });
  const list = useMemo(() => (data?.campaigns ?? []).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.id.includes(q)), [data, q]);
  const isG = platform === 'google';
  return (
    <>
      <PageHead title={isG ? 'Google Ads' : 'Meta Ads'} sub={`Campanhas · ${longDate(f.from)} – ${longDate(f.to)}${isG ? '' : ' · Spend inclui IVA de 13,83%'}`} />
      <Provisional show={f.to >= addDays(todayISO(), -3)} />
      {isLoading && !data ? <PageSkeleton /> : error && !data ? <ErrorBox error={error} retry={() => refetch()} /> : data && (
        <>
          <Box sx={{ mb: 1.75 }}><KpiRow m={data.totals} cmp={data.comparison} split={false} /></Box>
          <Card>
            <Stack direction="row" spacing={1.25} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', p: 1.75, borderBottom: 1, borderColor: 'divider' }}>
              <TextField size="small" placeholder="Pesquisar campanha ou ID" value={q} onChange={(e) => setQ(e.target.value)} sx={{ width: 240 }} />
              <Select size="small" displayEmpty value={accountId} onChange={(e) => setAccountId(e.target.value)} inputProps={{ 'aria-label': 'Conta' }}>
                <MenuItem value="">Todas as contas</MenuItem>{data.accounts.map((a) => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
              </Select>
              {isG && <FormControlLabel control={<Checkbox size="small" checked={!includePaused} onChange={(e) => setIncludePaused(!e.target.checked)} />} label="Ocultar pausadas" slotProps={{ typography: { sx: { fontSize: 13, color: 'text.secondary' } } }} />}
              <Box sx={{ flex: 1 }} /><MetricPicker screen={platform} />
            </Stack>
            <CampaignTable screen={platform} campaigns={list} totals={data.totals} totalsRoiDays={data.totalsRoiDays} />
          </Card>
          <Typography variant="caption" component="p" sx={{ mt: 1.25 }}>Clique na seta para abrir {isG ? 'grupos de anúncios e criativos' : 'conjuntos e criativos'}. O globo abre os países da campanha.</Typography>
        </>
      )}
    </>
  );
}
