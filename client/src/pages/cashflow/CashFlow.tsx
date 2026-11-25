import { Alert, AlertTitle, Card, CardContent, Typography } from '@mui/material';
import { PageHead } from '@/components/ui/States';

/**
 * 0.18.14 · Fluxo de caixa por faturas de cartão (por usuário). Só com a flag can_use_cashflow (SuperAdmin atribui).
 * Etapa 1: a permissão. Upload das faturas, lançamentos e o agrupamento por origem chegam nas próximas versões.
 */
export default function CashFlow() {
  return (
    <>
      <PageHead title="Fluxo de caixa" sub="Lançamentos a partir das faturas de cartão de crédito (PDF). Os dados são só seus." />
      <Card><CardContent>
        <Alert severity="info">
          <AlertTitle>Módulo liberado para o seu usuário</AlertTitle>
          <Typography variant="body2">
            Em breve: envio de faturas em PDF, lançamentos com data, descrição e valor, e a soma mensal por origem
            (ex.: todas as compras "FACEBK *…" do mês somadas como despesas com campanhas no Facebook, mesmo vindas de cartões diferentes).
          </Typography>
        </Alert>
      </CardContent></Card>
    </>
  );
}
