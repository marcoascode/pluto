import { Alert, Box, Snackbar, Card, CardHeader, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useState } from 'react';
import { useUnmappedCampaigns } from '@/hooks/queries';
import { CampaignDomainSelect } from '@/components/campaigns/CampaignDomainSelect';
import { ErrorBox, PageSkeleton, Tag } from '@/components/ui/States';
import { ddmm, int, money } from '@/lib/format';
import type { Platform } from '@/types/api';

/**
 * Campanhas sem domínio (custo gravado em "Sem domínio" nos últimos 30 dias, ou ativas sem domínio), com o seletor
 * de domínio ao lado. É a lista do aviso "linhas sem domínio" das contas. Ao salvar, o passado é movido e a janela
 * da plataforma é ressincronizada.
 */
export function UnmappedCampaignsCard({ platform = 'meta' }: { platform?: Platform }) {
  const { data, error, refetch } = useUnmappedCampaigns(platform);
  const [saved, setSaved] = useState('');
  const snack = <Snackbar open={!!saved} autoHideDuration={4500} onClose={() => setSaved('')} message={saved} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />;
  if (error) return <Box sx={{ mt: 1.75 }}><ErrorBox error={error} retry={() => refetch()} /></Box>;
  if (!data) return <Box sx={{ mt: 1.75 }}><PageSkeleton /></Box>;
  const list = data.campaigns;
  if (!list.length) return <><Alert severity="success" variant="outlined" sx={{ mt: 1.75 }}>Nenhuma campanha sem domínio nos últimos {data.days} dias. Todo o custo está ligado a um site.</Alert>{snack}</>;
  return (
    <Card sx={{ mt: 1.75, borderColor: 'warning.main' }}>
      <CardHeader title={<Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><span>Campanhas sem domínio</span><Tag tone="warn">{list.length}</Tag></Stack>}
        subheader={`${money(data.totals.spend, 'USD')} de custo (com IVA) nos últimos ${data.days} dias está em "Sem domínio": entra no total, mas em nenhum site. Defina o domínio de cada campanha; o histórico é movido e a janela é ressincronizada.`} />
      <TableContainer><Table>
        <TableHead><TableRow>{['Campanha', 'Conta', 'Custo', 'Cliques', 'Período', 'Domínio'].map((h) => <TableCell key={h} align={['Custo', 'Cliques'].includes(h) ? 'right' : 'left'}>{h}</TableCell>)}</TableRow></TableHead>
        <TableBody>{list.map((c) => (
          <TableRow key={c.id}>
            <TableCell sx={{ whiteSpace: 'normal', minWidth: 220 }}><b>{c.name}</b><Typography variant="caption" component="div" sx={{ fontFamily: 'IBM Plex Mono' }}>{c.id}{c.status !== 'ENABLED' ? ' · Pausada' : ''}</Typography></TableCell>
            <TableCell>{c.accountName}</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{c.spend ? money(c.spend, 'USD') : '—'}</TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{c.rows ? int(c.clicks) : '—'}</TableCell>
            <TableCell>{c.firstDate && c.lastDate ? `${ddmm(c.firstDate)} – ${ddmm(c.lastDate)}` : 'sem custo ainda'}</TableCell>
            <TableCell><CampaignDomainSelect id={c.id} platform={c.platform} name={c.name} onSaved={setSaved} /></TableCell>
          </TableRow>
        ))}</TableBody>
      </Table></TableContainer>
      {snack}
    </Card>
  );
}
