import { Button, Card, CardContent, CardHeader, Grid, Snackbar, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { useState } from 'react';
import { useAdminMutation } from '@/hooks/queries';
import { adminApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';
import { SyncPanel } from './shared';
import { useFx, useFxHistory } from '@/hooks/queries';
import { PageHead, PageSkeleton } from '@/components/ui/States';
import { relTime } from '@/lib/format';

export default function CurrencyPage() {
  const { data: fx } = useFx();
  const { data: hist } = useFxHistory();
  const [msg, setMsg] = useState('');
  const refresh = useAdminMutation(adminApi.refreshFx, [qk.fx, qk.fxHistory]);
  if (!fx) return <PageSkeleton />;
  return (
    <>
      <PageHead title="Moedas" sub="USD é a moeda principal. Valores em moedas diferentes nunca são somados direto." />
      <Grid container spacing={1.75}>
        <Grid size={{ xs: 12, md: 6 }}><Card sx={{ height: '100%' }}><CardHeader title="Cotação atual" subheader={`${fx.source} · atualizada ${relTime(fx.fetchedAt)}`}
          action={<Button size="small" variant="outlined" startIcon={<RefreshRoundedIcon />} disabled={refresh.isPending} onClick={() => refresh.mutate(undefined, { onSuccess: () => setMsg('Cotação atualizada.'), onError: (e) => setMsg(e instanceof ApiError ? e.message : 'A API de câmbio não respondeu.') })}>{refresh.isPending ? 'Buscando…' : 'Atualizar agora'}</Button>} />
          <CardContent><Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: 30 }}>USD/BRL {fx.rates.BRL.toFixed(4).replace('.', ',')}</Typography>
            <Typography variant="caption" component="div">USD/EUR {fx.rates.EUR.toFixed(4).replace('.', ',')}</Typography>
            <Typography variant="caption" component="p" sx={{ mt: 2 }}>Fonte: Frankfurter (taxas de referência de bancos centrais, sem chave de API). O servidor guarda a taxa de cada dia e converte linha a linha antes de somar; fins de semana usam a última taxa publicada.</Typography></CardContent></Card></Grid>
        <Grid size={{ xs: 12, md: 6 }}><TableContainer component={Card}><Table size="small">
          <TableHead><TableRow><TableCell>Data</TableCell><TableCell align="right">BRL</TableCell><TableCell align="right">EUR</TableCell></TableRow></TableHead>
          <TableBody>{hist?.rows.map((r) => <TableRow key={r.date}><TableCell>{r.date}</TableCell><TableCell align="right">{r.BRL.toFixed(4)}</TableCell><TableCell align="right">{r.EUR.toFixed(4)}</TableCell></TableRow>)}</TableBody>
        </Table></TableContainer></Grid>
      </Grid>
      <SyncPanel provider="fx" />
      <Snackbar open={!!msg} autoHideDuration={3000} onClose={() => setMsg('')} message={msg} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </>
  );
}
