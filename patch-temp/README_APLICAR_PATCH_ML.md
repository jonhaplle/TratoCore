# TratoCore — Patch ML: arquitetura oficial de publicação

## O que este patch muda

O fluxo deixa de depender de regras fixas por `category_id` no `item.service.js`.

Agora a publicação segue:

1. Category Predictor
2. Categoria final/folha
3. Atributos da categoria
4. Listing type disponível para usuário + categoria
5. Montagem dinâmica de atributos
6. Atributos condicionais
7. `/items/validate`
8. `/items`
9. descrição
10. gravação da publicação

## Arquivos

- `api/services/ml/publicationSpec.service.js` — descoberta da ficha da publicação.
- `api/services/ml/attributeResolver.service.js` — resolução dinâmica de atributos.
- `api/services/ml/api.service.js` — novos endpoints oficiais.
- `api/services/ml/item.service.js` — payload genérico, sem `if` por categoria.
- `api/services/ml/publish.service.js` — pipeline oficial + validador antes da publicação.
- `api/services/ml/token.service.js` — refresh OAuth em `application/x-www-form-urlencoded`.
- `api/services/productService.js` — default Premium `gold_pro`.
- `api/routes/ml.js` — rotas de diagnóstico de categoria.
- `docs/ML_PUBLICATION_BLUEPRINT.md` — desenho da arquitetura.

## Regra importante

Este patch não faz downgrade automático de `gold_pro`. Se `gold_pro` não estiver disponível para o usuário/categoria, a publicação para com mensagem explícita.

## Antes de aplicar

Faça backup dos arquivos correspondentes no `C:\TratoCore\backup`.

Depois de copiar:

```powershell
& "C:\Program Files\nodejs\node.exe" --check "C:\TratoCore\api\services\ml\publicationSpec.service.js"
& "C:\Program Files\nodejs\node.exe" --check "C:\TratoCore\api\services\ml\attributeResolver.service.js"
& "C:\Program Files\nodejs\node.exe" --check "C:\TratoCore\api\services\ml\api.service.js"
& "C:\Program Files\nodejs\node.exe" --check "C:\TratoCore\api\services\ml\item.service.js"
& "C:\Program Files\nodejs\node.exe" --check "C:\TratoCore\api\services\ml\publish.service.js"
& "C:\Program Files\nodejs\node.exe" --check "C:\TratoCore\api\services\ml\token.service.js"
& "C:\Program Files\nodejs\node.exe" --check "C:\TratoCore\api\services\productService.js"
& "C:\Program Files\nodejs\node.exe" --check "C:\TratoCore\api\routes\ml.js"
```

Não publique um anúncio real até os testes de categoria, atributos, listing type e `/items/validate` retornarem OK.
