# Trato Vendedor IA — versão inicial

## Objetivo
Terminal web de atendimento ao cliente, disponível na rede local e remotamente pela mesma aplicação TratoCore.

## Implantação
- Local: iniciar o TratoCore no notebook e abrir `http://localhost:3000/vendedor.html` ou o endereço LAN do notebook.
- Remoto: abrir `https://SEU-DOMINIO/vendedor.html` no navegador.
- A interface usa URLs relativas e a mesma API da origem; não requer CORS adicional nem segundo servidor.

## Escopo da versão 1
- Pesquisa textual com normalização de acentos e pontuação.
- Pesquisa somente de produtos com status ACTIVE, quantidade maior que zero e preço maior que zero.
- Exibição de foto, título, condição e preço.
- Entrada por voz quando o navegador oferece Web Speech Recognition.
- Resposta falada pelo Speech Synthesis do navegador.
- Encaminhamento de dúvidas para uma caixa de atendimento persistida no PostgreSQL.
- Caixa da equipe protegida por `TRATO_VENDEDOR_ADMIN_KEY`.

## Configuração
Defina a mesma variável de ambiente nos ambientes em que a caixa da equipe será usada:

```env
TRATO_VENDEDOR_ADMIN_KEY=gere-uma-chave-longa-e-exclusiva
```

Não reutilize a chave do Google Drive nem credenciais do Mercado Livre.

## Rotas
- `GET /api/vendedor/status`
- `GET /api/vendedor/search?q=termo`
- `POST /api/vendedor/handoff`
- `GET /api/vendedor/handoffs` — exige `Authorization: Bearer <TRATO_VENDEDOR_ADMIN_KEY>`

A tabela `trato_vendedor_handoffs` é criada automaticamente na primeira solicitação de encaminhamento. Nenhuma tabela existente é alterada.

## Limites conhecidos
- A busca da versão 1 é lexical, sem LLM; não interpreta intenção complexa nem responde perguntas sobre características que não estejam no cadastro.
- Voz depende do suporte do navegador e normalmente exige contexto seguro (HTTPS ou localhost).
- O catálogo público usa status ACTIVE para evitar mostrar rascunhos e produtos pausados.
- Fotos servidas por proxy externo podem exigir internet mesmo quando a interface local está disponível.
- A caixa de atendimento lista solicitações novas; a atualização de status e o painel operacional completo ficam para uma etapa posterior.

## Isolamento
O módulo adiciona arquivos próprios e uma montagem de rota em `api/server.js`. Não altera TratoCap, publicação do Mercado Livre, serviços de IA existentes ou modelos de produtos.
