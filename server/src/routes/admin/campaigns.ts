import { Router } from 'express';
import { pool } from '../../db.js'; // Biblioteca pg com pool definida em server/src/db.ts

const router = Router();

/**
 * GET /admin/campaigns/unassigned
 * Retorna a lista de campanhas da Meta Ads que não possuem um domínio vinculado.
 */
router.get('/unassigned', async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT c.id::text, 
             c.external_id AS "externalId", 
             c.name, 
             c.account_id::text AS "accountId", 
             a.name AS "accountName"
        FROM campaigns c
        JOIN integration_accounts a ON a.id = c.account_id
       WHERE c.platform = 'meta' 
         AND c.domain_id IS NULL
       ORDER BY c.updated_at DESC
    `);
    
    res.json({ campaigns: result.rows });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /admin/campaigns/:id
 * Define ou atualiza manualmente o domínio de destino de uma campanha.
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { domainId } = req.body;

    // 1. Validação do body
    if (!domainId) {
      return res.status(422).json({ 
        error: { code: 'missing_domain', message: 'O ID do domínio é obrigatório.' } 
      });
    }

    // 2. Verifica se o domínio informado realmente existe no banco (usando hostname)
    const domainCheck = await pool.query(
      `SELECT 1 FROM domains WHERE hostname = $1`, 
      [domainId]
    );

    if (domainCheck.rowCount === 0) {
      return res.status(404).json({ 
        error: { code: 'domain_not_found', message: 'O domínio informado não está cadastrado no sistema.' } 
      });
    }

    // 3. Atualiza o vínculo da campanha preservando a edição manual
    const updateResult = await pool.query(`
      UPDATE campaigns
         SET domain_id = $2, 
             updated_at = now()
       WHERE id = $1
       RETURNING id::text, domain_id AS "domainId", name
    `, [id, domainId]);

    // 4. Se o ID da campanha for inválido
    if (updateResult.rowCount === 0) {
      return res.status(404).json({ 
        error: { code: 'campaign_not_found', message: 'Campanha não encontrada.' } 
      });
    }

    res.json(updateResult.rows[0]);
  } catch (error) {
    next(error);
  }
});

export default router;