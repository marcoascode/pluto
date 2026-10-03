import { Alert, Card, CardContent, CardHeader, Grid, IconButton, Link, Table, TableBody, TableCell, TableRow, Tooltip } from '@mui/material';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import { Link as RouterLink } from 'react-router-dom';
import { useUtmTemplates } from '@/hooks/queries';
import { PageHead, PageSkeleton, copyText } from '@/components/ui/States';

const MAP = { google: [['Campaign', '{campaignid}'], ['Ad Group', '{adgroupid}'], ['Creative', '{creative}'], ['Keyword', '{keyword}'], ['Placement', '{placement}'], ['Network', '{network}'], ['Device', '{device}']], meta: [['Campaign', '{{campaign.id}}'], ['Ad Set', '{{adset.id}}'], ['Ad', '{{ad.id}}'], ['Placement', '{{placement}}'], ['Source', '{{site_source_name}}']] };

export default function UtmsPage() {
  const { data } = useUtmTemplates();
  if (!data) return <PageSkeleton />;
  return (
    <>
      <PageHead title="Attribution / UTMs" sub="Uma estrutura padrão por plataforma. Use exatamente estes parâmetros em todas as campanhas." />
      <Grid container spacing={1.75}>{(['google', 'meta'] as const).map((k) => (
        <Grid key={k} size={{ xs: 12, md: 6 }}><Card sx={{ height: '100%' }}>
          <CardHeader title={k === 'google' ? 'Google Ads UTM' : 'Meta Ads UTM'} subheader={k === 'google' ? 'Sufixo do URL final (nível da conta ou campanha)' : 'Parâmetros de URL do anúncio'} />
          <CardContent>
            <Alert icon={false} variant="outlined" severity="info" action={<Tooltip title="Copiar"><IconButton size="small" onClick={() => copyText(data[k])}><ContentCopyRoundedIcon fontSize="small" /></IconButton></Tooltip>} sx={{ fontFamily: 'IBM Plex Mono', fontSize: 12.5, overflowWrap: 'anywhere', mb: 1.5 }}>{data[k]}</Alert>
            <Table size="small"><TableBody>{MAP[k].map(([l, v]) => <TableRow key={l}><TableCell sx={{ width: '40%' }}>{l}</TableCell><TableCell sx={{ fontFamily: 'IBM Plex Mono' }}>{v}</TableCell></TableRow>)}</TableBody></Table>
          </CardContent>
        </Card></Grid>
      ))}</Grid>
      <Alert severity="info" variant="outlined" sx={{ mt: 1.75 }}>Antes de subir uma campanha, cole a URL final no <Link component={RouterLink} to="/utm-debugger">UTM Debugger</Link>.</Alert>
    </>
  );
}
