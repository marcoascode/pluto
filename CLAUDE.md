# Pluto Dashboard (app.plutomidia.com.br)

## Stack & Arquitetura
- **Backend:** Node.js + TypeScript + PostgreSQL (rodando em Docker no Hetzner).
- **Frontend:** React + TypeScript.
- **Integrações Existentes:** Meta Graph API, Google Ads MCC, Google Ad Manager.

## Regras para o Claude Code (v0.18.0)
1. **Economia de Contexto:** Leia apenas os diretórios estritamente necessários para a etapa solicitada. Nunca varra pastas de build (`dist/`, `build/`), logs ou `node_modules/`.
2. **Ambiente Cloud (Sem `.env`):** O ambiente atual não possui acesso ao banco PostgreSQL de produção nem às chaves de API. Valide o código usando apenas checagem estática de tipos (`npx tsc --noEmit`) e build (`npm run build`), sem tentar rodar migrations ou conexões reais com o banco.
3. **Governança:** A nova funcionalidade de criação automatizada de campanhas Meta deve ser controlada pela flag `can_create_meta_campaigns` na tabela de usuários, atribuível exclusivamente por usuários com role `SuperAdmin`.
4. **Criativos:** Nunca salve imagens no disco do servidor; todo upload de criativo deve trafegar em memória (buffer) direto para a Meta Graph API.