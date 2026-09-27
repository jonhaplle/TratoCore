# TratoCore — Blueprint oficial do fluxo de publicação Mercado Livre

## Objetivo

O TratoCore não deve descobrir uma categoria por código fixo e depois tentar publicar. A categoria e a ficha técnica devem ser determinadas antes da montagem final do anúncio.

## Fluxo oficial adotado

```text
PRODUTO
  |
  v
TÍTULO FINAL
  |
  v
GET /sites/MLB/domain_discovery/search
  |
  +--> predictions[0] = maior probabilidade
  |
  v
category_id
  |
  v
GET /categories/{category_id}
  |
  +--> categoria folha?
  |       |
  |       +-- NÃO -> interromper / revisar previsão
  |       +-- SIM
  |
  v
GET /categories/{category_id}/attributes
  |
  +--> required
  +--> conditional_required
  +--> allowed values
  +--> hidden/read_only/variation metadata
  |
  v
GET /users/{user_id}/available_listing_types?category_id={category_id}
  |
  +--> exigir gold_pro conforme regra do TratoCore
  |
  v
MONTAR PAYLOAD
  |
  v
POST /categories/{category_id}/attributes/conditional
  |
  +--> descobrir requisitos condicionais
  |
  v
POST /items/validate
  |
  +--> se falhar: NÃO publicar
  |
  v
POST /items
  |
  v
CRIAR DESCRIPTION (se houver)
  |
  v
SALVAR ml_item_id / status / permalink
```

## Regras do TratoCore

1. Nunca fixar `category_id` por tipo de produto no `item.service.js`.
2. Usar o primeiro resultado do Category Predictor como candidato principal.
3. Confirmar que a categoria é folha antes de publicar.
4. Consultar os atributos da categoria antes de montar o payload.
5. Não preencher atributos `hidden`, `read_only` ou `fixed` automaticamente.
6. Atributos `required` precisam estar presentes.
7. Atributos `conditional_required` devem ser validados pelo endpoint `/attributes/conditional`.
8. Não fabricar GTIN. Sem GTIN, usar `EMPTY_GTIN_REASON` somente quando aplicável; o padrão do projeto para produto sem código é `17055160`.
9. `gold_pro` é a preferência do TratoCore. Se não estiver disponível para a categoria/usuário, interromper e informar o motivo; não fazer downgrade silencioso.
10. Validar o payload em `/items/validate` antes de chamar `/items`.
11. Só salvar a publicação no banco depois de `POST /items` retornar sucesso.
12. O `item.service.js` deve ser genérico por categoria.

## Separação de responsabilidades

### `api.service.js`

Transporte/autenticação contra a API do Mercado Livre:

- predictor
- category detail
- category attributes
- conditional attributes
- available listing types
- validate item
- publish item
- description

### `publicationSpec.service.js`

Orquestra a descoberta da ficha de publicação:

- predictor
- categoria folha
- atributos
- usuário
- listing type disponível

### `attributeResolver.service.js`

Converte dados conhecidos do produto + predictor + atributos permitidos da categoria em `attributes[]`.

Não contém `if (category_id === ...)`.

### `item.service.js`

Monta o payload base do `/items` usando a ficha descoberta. Não conhece categorias específicas.

### `publish.service.js`

Orquestra o processo completo e impede a publicação quando o validador oficial reprovar o payload.

## Caso real já testado

Título:

`Conjunto de Pratos Fundos Duralex Ambar Vintage`

Predictor retornou:

- domínio: `MLB-DISHES_PLATES`
- categoria: `MLB191838`
- nome: `Pratos`

A categoria é folha e aceita item usado. A consulta de atributos mostrou `BRAND` como obrigatório e `DISH_PLATE_TYPE` como atributo de catálogo, além de `GTIN`/`EMPTY_GTIN_REASON` como condicionais.

O TratoCore não deve mais codificar `MLB191838` como regra especial. O mesmo mecanismo deve funcionar para qualquer categoria retornada pelo Mercado Livre.

## Fonte normativa

Implementação baseada na documentação oficial do Mercado Livre para:

- Categorização de produtos
- Atributos
- Atributos condicionais
- Tipos de publicação
- Validador de publicações
