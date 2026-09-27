# TratoCore 0.6.0 — correções desta versão

## Diagnóstico
O fluxo de identificação ML007 estava funcionando, mas o frontend esperava campos planos (`title`, `brand`, `model`, etc.) enquanto a IA retornava a identificação consolidada em `resultado.identification`.

Também havia uma quebra no fluxo de publicação: `publicationSpec.service.js` chamava métodos do `api.service.js` que não existiam na versão ativa.

## Correções
- Integração da identificação ML007 com o frontend.
- Novo `api/services/listing.service.js` para gerar rascunho comercial com base somente em evidências.
- Novo `api/services/catalog.service.js` para consultar o catálogo e usar o `catalogMatcher` sem bloquear a identificação quando a busca falhar.
- Adicionados ao `api/services/ml/api.service.js`:
  - `getCategory`
  - `getCategoryAttributes`
  - `getConditionalAttributes`
  - `getAvailableListingTypes`
  - `validateItem`
- `gold_pro` passou a ser o padrão também no modelo de produto.
- Versão do servidor/package atualizada para 0.6.0.
- Corrigido script legado `corrigir_observacao_ia.js` que estava com erro de sintaxe.
- Todos os 83 arquivos JavaScript ativos/auxiliares passaram em `node --check`.

## Fluxo esperado
Foto -> Upload -> Google Lens -> Identificação GPT -> Catalog Matcher -> Gerador de rascunho -> formulário -> salvar -> publicação ML com Category Predictor + ficha técnica + validação.

## Observação
O arquivo `.env` NÃO foi incluído neste pacote para não transportar credenciais. Mantenha o `.env` existente em `C:\TratoCore`.
