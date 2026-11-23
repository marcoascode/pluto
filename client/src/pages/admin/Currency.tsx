import { Alert, Box, Button, Card, CardContent, CardHeader, Grid, InputAdornment, Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { useState } from 'react';
import { useAdminMutation } from '@/hooks/queries';
import { adminApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';
import { SyncPanel } from './shared';
import { useFx, useFxDiscount, useFxHistory } from '@/hooks/queries';
import { todayISO } from '@/lib/period';
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
      <PageHead title="Moedas" sub="Receita do Ad Manager em USD · despesas (Google Ads, Meta Ads e IVA) em BRL. A conversão só acontece no ROI: Receita × cotação − Despesas." />
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
      <DiscountCard brl={fx.rates.BRL} onSaved={setMsg} />
      <SyncPanel provider="fx" />
      <Snackbar open={!!msg} autoHideDuration={3000} onClose={() => setMsg('')} message={msg} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </>
  );
}

const n4 = (v: number) => v.toFixed(4).replace('.', ',');
/**
 * Deságio: R$ descontado da cotação USD/BRL na receita do Google Ad Manager (o que o banco paga a menos ao converter).
 * Ex.: cotação 4,9881 − deságio 0,06 = 4,9281. 0.18.6: é a cotação do ROI dos meses sem cotação travada (Relatórios → Resultados mensais).
 */
function DiscountCard({ brl, onSaved }: { brl: number; onSaved: (m: string) => void }) {
  const { data } = useFxDiscount();
  const today = todayISO();
  const [v, setV] = useState<string | null>(null);
  const [from, setFrom] = useState(today);
  const [err, setErr] = useState('');
  const save = useAdminMutation(adminApi.saveFxDiscount, [qk.fxDiscount, qk.fx, ['dashboard'], ['reportDaily'], ['reportMonthly']]);
  if (!data) return null;
  const cur = data.current?.amount ?? 0;
  const val = v ?? n4(cur).replace(/0+$/, '').replace(/,$/, ',00');
  const amount = Number(val.replace(',', '.'));
  const ok = Number.isFinite(amount) && amount >= 0 && amount < 5;
  const first = !data.history.length;
  const submit = () => {
    if (!ok) return setErr('Digite um valor em R$ entre 0 e 4,9999 (ex.: 0,06).');
    setErr('');
    save.mutate({ amount, ...(first ? {} : { validFrom: from }) }, { onSuccess: () => { setV(null); onSaved('Deságio salvo.'); }, onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.') });
  };
  return (
    <Card sx={{ mt: 1.75 }}>
      <CardHeader title="Deságio (USD/BRL)" subheader="Reduz a cotação usada no ROI (Receita do Ad Manager × cotação − Despesas) dos meses sem cotação travada" />
      <CardContent>
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1.5}>
                <TextField label="Deságio" value={val} onChange={(e) => setV(e.target.value.replace(/[^\d,.]/g, ''))} error={!ok} sx={{ flex: 1 }}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start">R$</InputAdornment> }, htmlInput: { inputMode: 'decimal', 'aria-label': 'Deságio em reais' } }} />
                {!first && <TextField label="Vale a partir de" type="date" value={from} onChange={(e) => setFrom(e.target.value)} sx={{ flex: 1 }} slotProps={{ inputLabel: { shrink: true } }} />}
              </Stack>
              <Typography variant="caption">{first ? 'O primeiro deságio vale para todo o histórico.' : 'Os dias anteriores à data mantêm o deságio antigo.'} Só a receita do Ad Manager em BRL usa a cotação com deságio; Spend (Google, Meta, IVA) usa a cotação cheia.</Typography>
              {err && <Alert severity="error" variant="outlined">{err}</Alert>}
              <Box><Button variant="contained" onClick={submit} disabled={save.isPending || (v === null)}>{save.isPending ? 'Salvando…' : 'Salvar deságio'}</Button></Box>
            </Stack>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Typography variant="overline">Cotação da receita hoje</Typography>
              <Typography sx={{ fontFamily: 'Sora', fontWeight: 600, fontSize: 26, mt: 0.5 }}>R$ {n4(Math.max(0.0001, brl - (ok ? amount : cur)))}</Typography>
              <Typography variant="caption" component="div">USD/BRL {n4(brl)} − deságio R$ {n4(ok ? amount : cur)}</Typography>
            </Box>
            {data.history.length > 0 && (
              <TableContainer sx={{ mt: 1.5 }}><Table size="small">
                <TableHead><TableRow><TableCell>Vale a partir de</TableCell><TableCell align="right">Deságio</TableCell><TableCell>Por</TableCell></TableRow></TableHead>
                <TableBody>{data.history.map((h) => (
                  <TableRow key={h.validFrom}><TableCell>{h.validFrom === '2000-01-01' ? 'todo o histórico' : h.validFrom.split('-').reverse().join('/')}</TableCell><TableCell align="right">R$ {n4(h.amount)}</TableCell><TableCell>{h.createdBy ?? '—'}</TableCell></TableRow>
                ))}</TableBody>
              </Table></TableContainer>
            )}
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}
