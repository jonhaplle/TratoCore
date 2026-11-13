# TratoCore — Vendedor automático (criação e publicação de anúncios no Mercado Livre)

Este documento descreve o fluxo implementado para transformar fotos de um produto em um
anúncio pronto no Mercado Livre, sempre com revisão e aprovação humana antes de publicar.

## Como usar (na prática)

1. Abra `http://localhost:3000/anuncio.html` (menu **Anúncio**) ou clique em
   **Revisar e publicar** em qualquer produto na tela de Produtos.
2. Escolha o produto (as fotos do TratoCap já ficam salvas no cadastro).
3. Escreva a **observação do vendedor** — é a única fonte aceita para estado,
   funcionamento, acessórios e defeitos.
4. Clique em **Analisar com IA** (ou **Preencher manualmente** se a IA estiver indisponível).
5. Revise numa única tela:
   - fotos e identificação (marca, modelo, capacidade, cor, estado, quantidade);
   - **categoria** (pode ser trocada: ela define quais atributos são exigidos);
   - evidências e **hipóteses** (o que foi identificado e o que precisa de confirmação);
   - perguntas pendentes;
   - título (com o limite oficial da categoria);
   - descrição;
   - preço e a explicação de como ele foi sugerido;
   - atributos do Mercado Livre (obrigatórios, condicionais, preenchidos e opcionais).
6. Marque **“Li e aprovo as informações deste anúncio”** e clique em **Publicar no Mercado Livre**.
7. O resultado mostra o **ID** (`MLB...`), o **link** do anúncio e o status.

Nada é publicado sem a caixa de aprovação e sem o clique em Publicar. Qualquer alteração
feita depois da aprovação desmarca a caixa e exige nova aprovação.

## Categoria do anúncio

A categoria é a raiz de tudo: ela decide quais atributos o Mercado Livre exige.
O TratoCore:

- usa o **nome do produto declarado pelo vendedor** (primeira oração da observação)
  para consultar o preditor oficial — títulos internos de cadastro não ajudam;
- ignora predicções que não comportam o produto (ex.: "Ebooks" para dados de RPG);
- mostra as 3 categorias previstas na revisão para o vendedor **trocar com um clique**,
  refazendo os atributos na hora.

## Inteligência artificial

A identificação tenta, nesta ordem:

1. **Gemini** (nuvem) — usada só se a chave for aceita pelo Google;
2. **Visão local** (Ollama, `qwen3-vl`) — quando a nuvem não está disponível;
3. **Declaração do vendedor** — quando nenhuma IA responde.

O topo da tela mostra qual das três está ativa. Variáveis opcionais no `.env`:

```
OLLAMA_URL=http://127.0.0.1:11434
LOCAL_VISION_MODEL=qwen3-vl:4b-instruct
LOCAL_VISION_TIMEOUT_MS=300000
LOCAL_VISION_ENABLED=true
```

Em máquinas sem GPU o modelo local é lento; se ele falhar, a tela avisa e segue para a
revisão manual, que tem o mesmo fluxo de aprovação.

## Regras de verdade (não inventar)

- **Estado (novo/usado)**: nunca é deduzido das fotos. Vem da declaração do vendedor ou
  é perguntado na tela.
- **Funcionamento, acessórios e defeitos**: só entram na descrição quando o vendedor declara.
- **Capacidade e variante**: aparecem como **hipótese** (com o motivo) quando não há
  evidência suficiente — o vendedor confirma antes de publicar.
- **Preço**: vem, em ordem, do vendedor → ofertas de catálogo do Mercado Livre (quando
  houver) → faixa de mercado cadastrada. Estimativas são marcadas como **ESTIMATIVA**.
- **Título**: montado sem repetição de palavras e sem hashtags, dentro do limite da categoria.
- **Atributos**: só os que o próprio Mercado Livre exige são tratados como pendência
  bloqueante (o restante aparece como preenchido por evidência/hipótese ou é opcional).

## Atributos do Mercado Livre — classificação

A tela e a publicação separam os atributos em:

| Classificação | Como é definida | Efeito |
|---|---|---|
| Obrigatório | `tags.required === true` na categoria | Bloqueia a publicação até ser preenchido |
| Condicional | retornado por `categories/{id}/attributes/conditional` | Bloqueia se o ML pedir na validação |
| Preenchido com evidência | já identificado ou vindo do cadastro | Enviado automaticamente, mostra a origem |
| Hipótese | padrão da linha (ex.: Dual SIM, cor sugerida) | Enviado, mas pede confirmação |
| Opcional | existe na categoria e não é exigido | Não bloqueia nunca |

Observações importantes descobertas na integração real:

- `SELLER_PACKAGE_*` (altura, largura, comprimento e peso da embalagem) passou a ser
  exigido no `/items/validate` mesmo com `tags.hidden`. O fluxo inclui as medidas na
  revisão e no payload; o conjunto só é enviado completo.
- `MANUFACTURER` costuma ser uma lista de fabricantes legais: quando o nome da marca
  não existe na lista, o valor é enviado como texto e o ML valida.
- `CARRIER` e `COLOR` são listas: valor livre é incompatível (erro "not valid").
  A tela sempre oferece as opções aceitas.
- `Número de homologação da Anatel` não pode ser inventado: sem o número real a
  validação do ML recusa. O número é digitado pelo vendedor na revisão.

## API de uso interno

| Método | Rota | Função |
|---|---|---|
| GET | `/api/vendedor/anuncio/status` | Conta conectada ao Mercado Livre |
| POST | `/api/vendedor/anuncio/revisao` | Monta o pacote de revisão (não publica) |
| POST | `/api/vendedor/anuncio/publicar` | Publica com `approve: true`; aceita `dryRun: true` |
| PATCH | `/api/ml/item/:itemId` | Altera preço, título, quantidade ou status |
| DELETE | `/api/ml/item/:itemId` | Encerra o anúncio |

Corpo de `/api/vendedor/anuncio/revisao`:

```json
{
  "productId": 123,
  "sellerObservation": "Samsung Galaxy A15, usado, funciona, com carregador",
  "overrides": { "condition": "used", "sale_price": 850, "title": "" },
  "attributeOverrides": { "CARRIER": "Desbloqueado" },
  "skipAi": false
}
```

Corpo de `/api/vendedor/anuncio/publicar` é o mesmo, mais `"approve": true`.
Sem `approve` a API responde `428 ML_APPROVAL_REQUIRED`.

## Testes

```powershell
cd C:\TratoCore
node --test "api/services/**/*.test.js"
```

Os testes usam mocks do Mercado Livre e nunca criam anúncio real. O modo `dryRun`
da publicação também valida e monta o payload sem enviar fotos nem criar item.

## Limitações conhecidas

- A conta usa a API da aplicação: a busca aberta `/sites/MLB/search` responde 403 para
  este app, então a referência de preço usa catálogo/ofertas e faixa de mercado.
  Isso aparece explicitamente na tela ("faixa de mercado cadastrada").
- A chave Gemini configurada é recusada pelo Google (formato `AQ.` com
  `ACCESS_TOKEN_TYPE_UNSUPPORTED`). A tela detecta isso e usa a visão local; sem IA,
  use **Preencher manualmente** — o restante do fluxo continua funcionando.
- O modelo de visão local depende do Ollama e pode não carregar em algumas máquinas
  (o `llama-server` encerra com erro de memória). Nesse caso a revisão manual assume.
- Anúncio de celular exige número de homologação da Anatel real do aparelho.
- As dimensões/peso da embalagem são exigidas pelo Mercado Livre e precisam ser
  informadas na revisão quando o produto ainda não as tem cadastradas.

## O que foi validado contra o Mercado Livre real (sem publicar)

- Categoria de celular (`MLB1055`, `gold_pro`) e de dados de RPG (`MLB457881`).
- `/items/validate` montando o payload completo com os atributos exigidos: os únicos
  erros restantes são dados que só o vendedor possui (número real da Anatel) e as
  medidas de embalagem do tipo de produto.
- Tela de revisão ponta a ponta no Chrome: identificação → atributos → aprovação →
  botão **Publicar** habilitado, inclusive trocando a categoria e usando
  **Melhorar com IA** com a IA indisponível (as regras locais organizam a descrição).
- Guardas de publicação: sem aprovação (`428`), sem atributos (`422`), produto
  inexistente (`404`) e produto já publicado (`409`). Em nenhum cenário o Mercado
  Livre recebeu um anúncio durante os testes.

## Referência de preço — o que é possível hoje

| Fonte | Status | Como aparece na tela |
|---|---|---|
| Ofertas de catálogo (`/products/{id}/items`) | disponível para alguns modelos | "Ofertas de catálogo", com mediana e faixa |
| Faixa curada observada no catálogo | disponível para os modelos da base | "faixa de mercado cadastrada" |
| Amostra da própria loja na categoria | quando há anúncios suficientes | "preços médios da sua loja" |
| Busca aberta `/sites/MLB/search` | **bloqueada (403)** para esta aplicação | — |
| Leitura de anúncios de terceiros por ID | **bloqueada (403)** — "access to the requested resource is forbidden" | — |
| Navegador público do Mercado Livre | **bloqueado** (verificação de conta / anti-robô) | — |

Sem `suggested`, a tela deixa o preço vazio e pede o valor — nunca inventa um número.
