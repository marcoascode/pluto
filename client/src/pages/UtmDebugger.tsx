import { Alert, Box, Button, Card, CardContent, CardHeader, Grid, IconButton, List, ListItem, ListItemIcon, ListItemText, Stack, TextField, Tooltip, Typography } from '@mui/material';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import CancelRoundedIcon from '@mui/icons-material/CancelRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import { useState } from 'react';
import { useUtmDebug } from '@/hooks/queries';
import { ErrorBox, PageHead, Tag, copyText } from '@/components/ui/States';

const LABELS: Record<string, string> = { campaignId: 'Campaign ID', adGroupId: 'Ad Group ID', adSetId: 'Ad Set ID', adId: 'Ad ID', creative: 'Creative', placement: 'Placement', keyword: 'Keyword', network: 'Network', device: 'Device' };

export default function UtmDebuggerPage() {
  const [url, setUrl] = useState('');
  const dbg = useUtmDebug();
  const r = dbg.data;
  const row = (l: string, v: string | null | undefined) => <Grid container key={l} sx={{ py: 0.5 }}><Grid size={{ xs: 12, sm: 5 }}><Typography color="text.disabled" sx={{ fontSize: 13.5 }} >{l}</Typography></Grid><Grid size={{ xs: 12, sm: 7 }}><Typography sx={{ fontFamily: 'IBM Plex Mono', fontSize: 13, overflowWrap: 'anywhere' }}>{v && !/[{}]/.test(v) ? v : '—'}</Typography></Grid></Grid>;
  return (
    <>
      <PageHead title="UTM Debugger" sub="Teste a URL antes de subir a campanha." />
      <Card sx={{ mb: 1.75 }}><CardContent>
        <TextField label="Cole a URL final" placeholder="https://dominioX.com/cw/page/?utm_source=..." value={url} onChange={(e) => setUrl(e.target.value)} multiline minRows={3} fullWidth slotProps={{ input: { sx: { fontFamily: 'IBM Plex Mono', fontSize: 12.5 } } }} />
        <Button variant="contained" sx={{ mt: 1.5 }} onClick={() => url.trim() && dbg.mutate(url)} disabled={dbg.isPending}>{dbg.isPending ? 'Analisando…' : 'Analisar URL'}</Button>
      </CardContent></Card>
      {dbg.error && <ErrorBox error={dbg.error} />}
      {r && (
        <>
          <Grid container spacing={1.75}>
            <Grid size={{ xs: 12, md: 6 }}><Card sx={{ height: '100%' }}><CardHeader title="Resultado" action={<Tag tone={r.status === 'valid' ? 'pos' : 'neg'}>{r.status === 'valid' ? 'VALID' : 'INVÁLIDA'}</Tag>} />
              <CardContent>{row('Source', r.source)}{row('Domain', r.domain)}{row('Campaign', r.campaign?.name)}{Object.entries(r.fields).map(([k, v]) => row(LABELS[k] ?? k, v))}</CardContent></Card></Grid>
            <Grid size={{ xs: 12, md: 6 }}><Card sx={{ height: '100%' }}><CardHeader title="Checagens" />
              <List dense>{r.checks.map((c, i) => (
                <ListItem key={i}><ListItemIcon sx={{ mr: 1.25 }}>{c.level === 'ok' ? <CheckCircleRoundedIcon color="success" /> : c.level === 'warn' ? <WarningAmberRoundedIcon color="warning" /> : <CancelRoundedIcon color="error" />}</ListItemIcon>
                  <ListItemText primary={c.message} secondary={c.detail} /></ListItem>))}</List></Card></Grid>
          </Grid>
          {r.preview.google && (
            <Card sx={{ mt: 1.75 }}><CardHeader title="Preview com o template padrão" subheader="Como a URL fica configurada em cada plataforma" />
              <CardContent><Stack spacing={1.75}>{(['google', 'meta'] as const).map((k) => (
                <Box key={k}><Typography variant="overline">{k === 'google' ? 'Google Ads' : 'Meta Ads'}</Typography>
                  <Alert icon={false} severity="info" variant="outlined" action={<Tooltip title="Copiar"><IconButton size="small" onClick={() => copyText(r.preview[k])}><ContentCopyRoundedIcon fontSize="small" /></IconButton></Tooltip>} sx={{ fontFamily: 'IBM Plex Mono', fontSize: 12.5, overflowWrap: 'anywhere' }}>{r.preview[k]}</Alert></Box>
              ))}</Stack></CardContent></Card>
          )}
        </>
      )}
    </>
  );
}
