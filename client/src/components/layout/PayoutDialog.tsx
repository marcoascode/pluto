/**
 * 0.18.13 · Dados de recebimento da comissão: o próprio usuário escolhe o meio (Chave PIX, Dolafy ou Outro)
 * e a identificação. Aparece no card do gestor em Finanças → Comissões, acima do botão Aprovar.
 */
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { meApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import type { PayoutMethod } from '@/lib/financeOps';

const KEY_LABEL: Record<PayoutMethod, string> = { pix: 'Chave PIX', dolafy: '@ Dolafy', other: 'Identificação para recebimento' };
const KEY_HINT: Record<PayoutMethod, string> = { pix: 'CPF, CNPJ, e-mail, telefone ou chave aleatória', dolafy: 'ex.: @seuusuario', other: 'conta, e-mail ou outro dado para o pagamento' };

export function PayoutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['me', 'payout'], queryFn: meApi.payout, enabled: open });
  const [method, setMethod] = useState<PayoutMethod | ''>('');
  const [other, setOther] = useState('');
  const [key, setKey] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open || !data) return;
    setMethod(data.method ?? ''); setOther(data.methodOther ?? ''); setKey(data.key ?? ''); setErr(null);
  }, [open, data]);

  const invalid = !!method && (!key.trim() || (method === 'other' && !other.trim()));
  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await meApi.savePayout({ method: method || null, methodOther: method === 'other' ? other.trim() : null, key: method ? key.trim() : null });
      await qc.invalidateQueries({ queryKey: ['me', 'payout'] });
      await qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.'); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Dados de recebimento</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="caption">Como você recebe a comissão. Aparece para quem aprova e paga as comissões.</Typography>
          <TextField select label="Meio de recebimento da comissão" value={method} disabled={isLoading} onChange={(e) => setMethod(e.target.value as PayoutMethod | '')}>
            <MenuItem value=""><em>Não informado</em></MenuItem>
            <MenuItem value="pix">Chave PIX</MenuItem>
            <MenuItem value="dolafy">Dolafy</MenuItem>
            <MenuItem value="other">Outro (especificar)</MenuItem>
          </TextField>
          {method === 'other' && <TextField label="Qual meio?" value={other} onChange={(e) => setOther(e.target.value)} slotProps={{ htmlInput: { maxLength: 60 } }} placeholder="ex.: Wise, PayPal, TED" />}
          {method && <TextField label={KEY_LABEL[method]} value={key} onChange={(e) => setKey(e.target.value)} helperText={KEY_HINT[method]} slotProps={{ htmlInput: { maxLength: 200 } }} />}
          {err && <Alert severity="error">{err}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={save} disabled={saving || isLoading || invalid}>Salvar</Button>
      </DialogActions>
    </Dialog>
  );
}
