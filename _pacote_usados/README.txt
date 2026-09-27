TRATOCORE — PACOTE PREPARAÇÃO PUBLICATION ENGINE / USADOS
Data: 2026-08-18

OBJETIVO
Este pacote NÃO altera anúncios do Mercado Livre.
Ele prepara a auditoria e a aplicação segura da regra de condição/GTIN no TratoCore.

ESTADO JÁ COMPROVADO
- Conta com 215 anúncios ativos foi encontrada.
- ME2 está ativo.
- Produto 17 / categoria MLB11172 foi publicado com sucesso usando:
  ITEM_CONDITION = 2230581 (Usado)
  EMPTY_GTIN_REASON = 17055160
- O aviso shipping.lost_me1_by_user não bloqueou a publicação.

ARQUIVOS
1. audit-ml-used-categories.js
   Audita os anúncios ativos, agrupa por categoria, consulta atributos
   obrigatórios/condicionais e salva JSON em logs\ml-audit.

2. install-audit.cmd
   Copia o auditor para C:\TratoCore\tools e executa validação de sintaxe.
   Também verifica se searchUserItems existe.

3. patch-search-user-items.cmd
   Adiciona searchUserItems ao api.service.js somente se ainda não existir.
   Faz backup antes da alteração.

4. verify-used-rule.cmd
   Verifica a regra ITEM_CONDITION no attributeResolver e executa
   node --check. Não publica nem altera anúncios.

ORDEM RECOMENDADA
1. Extraia o ZIP em C:\TratoCore.
2. Execute install-audit.cmd.
3. Execute:
   node tools\audit-ml-used-categories.js --validate
4. Envie o relatório mostrado no console ou o JSON criado em:
   logs\ml-audit\
5. Só depois aplicaremos regras específicas por categoria.

IMPORTANTE
Não existe neste pacote qualquer rotina de atualização em massa de anúncios.
A alteração de anúncios será uma etapa separada e somente após a auditoria.
