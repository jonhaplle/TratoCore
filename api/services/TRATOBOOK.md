Atualizado. O TRATOBOOK.md foi atualizado para a versão 5.0, com o estado real desta madrugada.

Ficou registrado principalmente:

✅ api.service.js corrigido e node --check OK.
✅ Todos os serviços ML testados com node --check.
✅ Servidor iniciando normalmente.
✅ PostgreSQL conectado.
✅ OpenAI carregada.
✅ OAuth/token/refresh /users/me permanecem fora do foco.
⚠️ domain_discovery continua 403.
⚠️ /sites/MLB/search continua 403.
✅ /products/search e /products/{id} funcionando.
🎯 Próximo ponto exato: catalogMatcher.service.js.
🎯 Corrigir filtragem de incompatíveis antes do ranking.
🎯 Repetir o teste do Xbox Classic.
⛔ Só depois integrar matcher à publicação.
📌 Registrei também o incidente de termos alterado o backup errado e a regra para não repetir isso.

O ponto de retomada ficou:

catalogMatcher → filtragem → ranking → teste Xbox Classic → match seguro → publicação.

Pode dormir. Amanhã não precisamos reabrir OAuth nem ficar consertando api.service.js. Vamos direto no matcher.

---

# CHECKPOINT — OBSERVAÇÃO DO VENDEDOR (2026-11-08)

## Objetivo desta etapa

Corrigir o fluxo de seller_observation no TratoCore, mantendo a observação original do vendedor separada da descrição comercial gerada pela IA.

Fluxo esperado:
- TratoCap envia fotos e observação do vendedor.
- TratoCore preserva a observação original no campo próprio.
- A observação participa da identificação e da geração do anúncio.
- A descrição comercial gerada pela IA permanece no campo description.
- A tela de edição carrega e permite corrigir a observação sem sobrescrever a descrição.

## Diagnóstico confirmado

### Banco de dados
- A tabela PostgreSQL products já possui a coluna seller_observation do tipo text.
- Não é necessária migration para criar essa coluna.

### Frontend — public/app.js e public/index.html
- O campo observacao_vendedor existe no HTML.
- app.js também possui uma função de fallback que cria o campo dinamicamente se o HTML antigo for carregado.
- A análise inicial envia o valor em observacaoVendedor para /api/ai/analyze.
- A correção do rascunho envia o valor em seller_observation para /api/ai/improve-draft.
- O payload de saveProduct() não inclui seller_observation; portanto, o cadastro normal não envia a observação para persistência.
- O trecho inspecionado do salvamento mostra que description e seller_observation são campos distintos na interface; essa separação deve ser mantida.

### Camada de serviço e modelo
- api/services/productService.js: create() e update() não propagam seller_observation; o campo é descartado antes de chegar ao model.
- api/models/productModel.js: create() e update() não incluem seller_observation nos comandos SQL.
- getById() e getAll() usam dados do produto, mas a normalização atual não trata explicitamente seller_observation.

### TratoCap / importação
- Foi identificado um caminho em api/routes/tratocap.js que lê note do sidecar JSON e grava o valor em description, em vez de seller_observation.
- Em api/services/tratocapImport.service.js, analyzeProduct() chama analisarImagem(imagePath, visual, '') e buildListing(... sellerObservation: ''); nesse fluxo a observação está sendo enviada vazia.
- Ainda não foi confirmado qual desses caminhos de importação é o efetivamente acionado pela interface atual. Não escolher nem alterar um caminho antes de rastrear a chamada ativa.

### IA e atributos
- api/services/local-ai.service.js já aceita observação em analisarImagem() e buildListing().
- api/services/ml/attributeResolver.service.js já lê seller_observation e aliases equivalentes para usar como fonte textual de atributos.
- api/services/identification.service.js contém createSellerFact(), mas a busca global realizada não encontrou chamadas ativas dessa função.
- Não criar um segundo pipeline de identificação. Integrar a observação ao fluxo efetivamente utilizado.

### Edição de produtos
- O salvamento do modal em public/produtos.js envia apenas SKU, título, preço, quantidade e status.
- A edição atual não carrega nem envia seller_observation no trecho auditado; isso precisa ser verificado junto com o HTML/modal e o controller.

## Arquivos ainda não inspecionados nesta auditoria

- api/routes/ai.js
- api/controllers/productsController.js

## Próximo passo exato

Executar no PowerShell, dentro de C:\TratoCore:

    Get-Content .\api\routes\ai.js | Select-Object -First 240; Get-Content .\api\controllers\productsController.js | Select-Object -First 260

Depois, fechar o rastreamento da rota de análise, do CRUD e do caminho de importação efetivamente ativo. Só então planejar e aplicar alterações pontuais.

## Regras obrigatórias desta correção

1. Não alterar a coluna existente nem criar migration desnecessária.
2. Não misturar observação do vendedor com descrição comercial.
3. Não descartar a observação em controller, service, model, importação ou frontend.
4. Preservar a observação original e permitir edição explícita.
5. Não criar pipeline paralelo nem duplicar serviços existentes.
6. Não reescrever arquivos inteiros.
7. Não modificar publicação Mercado Livre, OAuth ou Google Drive sem necessidade demonstrada.
8. Não fazer publicação real de anúncio durante esta correção.
9. Executar testes direcionados e registrar resultados reais.
10. Até este checkpoint, nenhum arquivo do código foi alterado nesta auditoria.
