import { MenuItem, Select, Stack, Tooltip, Typography } from '@mui/material';
import { useLocation } from 'react-router-dom';
import { useFilters } from '@/context/FiltersContext';
import { useFx, useMyDomains } from '@/hooks/queries';
import { relTime } from '@/lib/format';
import type { Currency } from '@/types/api';
import { DateFilter } from './DateFilter';
import { CompanyPicker } from './CompanyPicker';

/** Data · Domínio · Moeda · Empresa · cotação USD/BRL (com deságio, quando houver). Em Relatórios a Data some (o mês é escolhido na própria tela).
 *  Em Placements o Domínio some (é o passo 1 do filtro da própria tela). */
export function TopFilters() {
  const f = useFilters();
  const { data: doms } = useMyDomains();
  const { data: fx } = useFx();
  const { pathname } = useLocation();
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', overflowX: 'auto', minWidth: 0, py: 0.25, '&::-webkit-scrollbar': { display: 'none' } }}>
      {pathname !== '/relatorios' && <DateFilter />}
      {pathname !== '/placements' && <Select size="small" value={f.domain} displayEmpty onChange={(e) => f.setDomain(e.target.value)} inputProps={{ 'aria-label': 'Domínio' }} sx={{ minWidth: 170, flexShrink: 0 }}>
        <MenuItem value="">Todos os domínios</MenuItem>
        {doms?.domains.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
      </Select>}
      <Select size="small" value={f.currency} onChange={(e) => f.setCurrency(e.target.value as Currency)} inputProps={{ 'aria-label': 'Moeda' }} sx={{ flexShrink: 0 }}>
        {(['USD', 'BRL', 'EUR'] as Currency[]).map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
      </Select>
      <CompanyPicker />
      {fx && (
        <Tooltip title={fx.brlDiscount ? `Cotação ${fx.rates.BRL.toFixed(4).replace('.', ',')} − deságio R$ ${fx.brlDiscount.toFixed(4).replace('.', ',')} = ${(fx.brlRevenueRate ?? fx.rates.BRL).toFixed(4).replace('.', ',')} (usada na receita do Ad Manager em BRL) · ${fx.source} · atualizada ${relTime(fx.fetchedAt)}` : `${fx.source} · atualizada ${relTime(fx.fetchedAt)}`}>
          <Typography variant="caption" sx={{ whiteSpace: 'nowrap', display: { xs: 'none', md: 'block' } }}>USD/BRL <b style={{ color: '#b5c4df' }}>{(fx.brlRevenueRate ?? fx.rates.BRL).toFixed(fx.brlDiscount ? 4 : 2).replace('.', ',')}</b>{fx.brlDiscount ? <span style={{ marginLeft: 4, opacity: 0.7 }}>c/ deságio</span> : null}</Typography>
        </Tooltip>
      )}
    </Stack>
  );
}
