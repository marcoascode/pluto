import { Autocomplete, Box, Button, Snackbar, Stack, TextField, Typography } from '@mui/material';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useAdminDomains, useSetCampaignDomain } from '@/hooks/queries';
import { ApiError } from '@/lib/api/client';
import type { Platform } from '@/types/api';

/**
 * Seletor "campanha → domínio" (só Admin/SuperAdmin). Usado em Integrações → Meta Ads ("Campanhas sem domínio")
 * e na lista de campanhas, no lugar do domínio, quando a campanha está em "Sem domínio".
 * Ao salvar, o servidor move as linhas já gravadas dessa campanha para o domínio e ressincroniza a janela.
 */
/** onSaved: quem mostra a confirmação (a linha some/troca depois de salvar, então o aviso fica no pai). */
export function CampaignDomainSelect({ id, platform, name, width = 230, dense, onSaved }: { id: string; platform: Platform; name: string; width?: number; dense?: boolean; onSaved?: (msg: string) => void }) {
  const { isAdmin } = useAuth();
  const { data } = useAdminDomains(isAdmin);
  const save = useSetCampaignDomain();
  const [value, setValue] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  if (!isAdmin) return <Typography variant="caption" component="span">Sem domínio</Typography>;
  const options = (data?.domains ?? []).filter((d) => d.active && !d.technical).map((d) => d.hostname);
  const submit = () => {
    if (!value) return;
    save.mutate({ id, platform, domain: value }, {
      onSuccess: (r) => { const m = `"${name}" agora é de ${r.campaign.domain}. ${r.movedRows} linha(s) movida(s)${r.resync ? ' · ressincronizando a janela' : ''}.`; if (onSaved) onSaved(m); else setMsg(m); },
      onError: (e) => setMsg(e instanceof ApiError ? e.message : 'Não foi possível salvar o domínio.'),
    });
  };
  return (
    <Box component="span" sx={{ display: 'inline-flex', verticalAlign: 'middle' }} onClick={(e) => e.stopPropagation()}>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
        <Autocomplete size="small" options={options} value={value} onChange={(_, v) => setValue(v)} sx={{ width }} disabled={save.isPending}
          noOptionsText="Nenhum domínio ativo" loading={!data}
          renderInput={(params) => <TextField {...params} placeholder="Definir domínio" slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, 'aria-label': `Domínio da campanha ${name}` } }}
            sx={{ '& .MuiInputBase-root': { py: dense ? '0 !important' : undefined, fontSize: 12.5, minHeight: dense ? 28 : 34 } }} />} />
        <Button size="small" variant="contained" disabled={!value || save.isPending} onClick={submit} startIcon={<LinkRoundedIcon />} sx={{ height: dense ? 28 : 32, whiteSpace: 'nowrap' }}>
          {save.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </Stack>
      <Snackbar open={!!msg} autoHideDuration={4500} onClose={() => setMsg('')} message={msg} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  );
}
