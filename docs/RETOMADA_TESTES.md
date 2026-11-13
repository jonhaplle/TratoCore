# RETOMADA — Validação do primeiro anúncio (Vendedor Automático)

> Documento de continuidade: qualquer nova sessão deve começar lendo este arquivo.
> Última atualização: 2026-11-12 (retomada após encerramento do DSH durante a Etapa 2).

## Estado do repositório (confirmado)

| Item | Valor |
|---|---|
| Branch | `feature/integracao-vendedor-automatico` |
| Commit | `a8a96e6b302cdeae696a07d2eabb75f1583920fe` |
| Base de produção | `758a6c9fd7b2802789c51a46b8941c6aa4626bcb` |
| Worktree | limpo |
| Backups | `C:\TratoCore-backup-mirror-20261112.git`, `...\TratoCore-backups\2026-11-12`, `...\producao-758a6c9`, `...\integracao-worktree-snapshot` |
| Stashes | 4 preservados (nenhum apagado) |

## Etapas

- [x] **Etapa 1 — Conferência** (branch, commit, worktree, backups)
- [x] **Etapa 2 — Testes** (139/139 aprovados em 11 lotes)
- [x] **Etapa 3 — Fluxo real** (validado até a aprovação, sem publicar — ver seção abaixo)
- [ ] **Etapa 4 — Correções** (P1 corrigido; P2/P3 aguardam decisão)
- [ ] **Etapa 5 — Qualidade comercial**

## Etapa 3 — Fluxo real (produto 14)

### Produtos reais no banco local

313 produtos, **293 já publicados**, 301 com fotos.
Candidatos reais (não publicados, com fotos): **14, 112, 76, 59, 39, 15, 10, 8**.
Produto validado: **ID 14 — "Samsung Galaxy A16 5G Azul Escuro"**.

### Etapas funcionais comprovadas (Chrome headless, sem publicar)

| # | Verificação | Resultado |
|---|---|---|
| 1 | `produtos.html` abre | 200, 313 linhas |
| 2 | Botão "Revisar e publicar" | presente na linha do produto |
| 3 | `anuncio.html?id=14` | ML conectado, IA Gemini, produto correto |
| 4 | Análise manual → revisão | categoria `MLB1055 Celulares`, título 33/60 |
| 5 | Fotos no anúncio | 1 foto, principal marcada |
| 6 | Edição de título/preço | refletida na tela |
| 7 | "Trocar produto" | volta para a seleção |
| 8 | Aprovação | **Publicar habilitado só após marcar** |
| 9 | Nada publicado | `ml_item_id = null` |

## Problemas encontrados na Etapa 3

### P1 — Referência de preço contaminada por oferta absurda (CORRIGIDO)

- **Sintoma:** referência de **R$ 750.000,00** para um celular de ~R$ 1.300.
- **Causa raiz:** oferta inconsistente do catálogo (`MLB6185567848`, R$ 750.000)
  entrava no conjunto de preços sem filtro.
- **Correção:** `removeOutliers()` em `api/services/ml/priceReference.service.js`.
  Com 3+ preços descarta fora de `[mediana/5, mediana×5]`; com 2 descarta o que estiver
  10× acima do menor; com 1 mantém.
- **Validação ao vivo:** referência passou a exibir só `R$ 1.299,90`.
- **Teste de regressão:** `priceReference.service.test.js` → **11/11**.

### P2 — Descrição antiga do cadastro é reaproveitada (CORRIGIDO — autorizado)

- **Sintoma:** a revisão exibia a descrição já gravada no produto, com características
  que o vendedor não confirmou agora.
- **Causa raiz (3 pontos):**
  1. `sellerListing.buildReview` → `draftProduct.description` herdava `product.description`;
  2. `sellerListing.publish` → `updates.description` usava o cadastro como fallback;
  3. `publishVendedor.publishSellerListing` → enviava `product.description` ao ML.
- **Correção:** a descrição comercial passou a vir **exclusivamente** de
  (a) texto escrito/aprovado na revisão, ou (b) descrição montada das evidências
  (identificação visual, observação do vendedor, características comprovadas).
  O texto do cadastro **não é apagado**, apenas não é usado — e a tela informa
  `legacy_description_ignored: true` / `description_source: "evidencias"`.
- **Validação ao vivo (produto 14):** descrição nova difere da antiga, o texto antigo
  não aparece, o defeito declarado ("Risco") aparece, nada de garantia/câmera/tela
  foi inventado e **o cadastro permaneceu inalterado**.
- **Testes:** `api/services/seller/legacyDescription.test.js` → **6/6**.

### P3 — Peso/dimensões da embalagem (RESOLVIDO)

**Auditoria da categoria `MLB1055` (API oficial, 197 atributos):**

| Classe | Quantidade | Observação |
|---|---|---|
| Obrigatórios (`tags.required`) | **8** | BRAND, MODEL, IS_DUAL_SIM, COLOR, CARRIER, MANUFACTURER, CELLPHONES_ANATEL_HOMOLOGATION_NUMBER, ALPHANUMERIC_MODELS |
| Exclusivos de NOVO (`new_required`) | **0** | nenhum atributo extra para produto novo |
| Ocultos (`tags.hidden`) | vários | inclui `ANATEL_HOMOLOGATION_NUMBER` (≠ do obrigatório) |
| Opcionais | restante | não bloqueiam |

**Anatel — verificado na validação real da API:**
- `CELLPHONES_ANATEL_HOMOLOGATION_NUMBER` **é obrigatório também para USADO**.
- Testado: sem Anatel → `missing_required`; com placeholder (11/12 dígitos ou formatado)
  → `error.item.attribute.anatel_homologation_number.value_name`.
- **Conclusão:** o número real do aparelho é inegociável para celulares. Não é inventável.

**Causas raiz e correções:**
1. A embalagem não aparecia na revisão por vir `tags.hidden`.
   → `attributeRequirementsVendedor` agora **sempre** inclui as 4 medidas como
   condicionais preenchíveis (sugestão "confirmar", editável).
2. O payload não recebia as medidas e o dry-run passava sem elas.
   → `publishVendedor` liga `requirePackageDimensions: true`; sem as 4 medidas a
   publicação retorna `422 ML_MISSING_ATTRIBUTES` com os campos faltantes.

**Comprovado ao vivo (produto 14):**

| Cenário | Resultado |
|---|---|
| Revisão | embalagem nos `filled`, editável na tela |
| Dry-run **sem** embalagem | `422 ML_MISSING_ATTRIBUTES` → `[WIDTH, LENGTH, HEIGHT, WEIGHT]` |
| Dry-run **com** embalagem | `200`, payload com 13 atributos, as 4 medidas incluídas |
| Publicar sem aprovação | bloqueado (aprovação humana obrigatória) |

**Regra de caixa/acessórios:** nenhum atributo de caixa, embalagem original ou
acessório é exigido — comprovado por teste (`usedProducts.test.js`).

### P4 — Contador do título não recalcula ao encurtar o texto

- Após editar o título o contador continuou `33/60`. Apenas informativo; o limite é
  aplicado corretamente no envio.

## Resultado das suítes (Etapa 2)

Resultado consolidado da sessão anterior antes do encerramento: **135/135 aprovados**
(`node --test api/services/**/*.test.js api/routes/*.test.js`).

Reexecução nesta retomada, grupo por grupo (28 arquivos de teste, execução em lotes pequenos
para evitar encerramento do processo):

| Grupo | Arquivos | Testes | Resultado |
|---|---|---|---|
| G1 — Resolvedor e exigências | attributeResolver.{service,identity,package,model} | 19 | **19/19** |
| G2 — Publicação ML | publicationFlow.integration, publicationDiagnostic | 10 | **10/10** |
| G3 — Imagem e galeria | picture.service, productImageService.selection | 6 | **6/6** |
| G4a — TratoCap e Drive OAuth | tratocapSyncQueue, googleDriveOAuthService, googleDriveOAuthStore | 16 | **16/16** |
| G4b — Drive serviço e diagnóstico | googleDriveService, googleDriveService.oauth, product13Diagnostic | 15 | **15/15** |
| G5 — Rotas de Drive/upload | googleDriveOAuth, productImages.proxy, upload.oauth | 7 | **7/7** |
| G6a — Seller: requisitos/catálogo/copy | attributeRequirementsVendedor, productCatalog, listingCopy, listingCopy.improve | 29 | **29/29** |
| G6b — Seller: identificação | identificationVendedor.service, identificationVendedor.ai | 10 | **10/10** |
| G6c — Seller: revisão/publicação | sellerListing.service, publishVendedor.service | 9 | **9/9** |
| G7 — Precificação | priceReference.service | 10 | **10/10** |
| G8 — Middleware e status | mlDiagnosticKeyAuth, driveStatus | 8 | **8/8** |
| **TOTAL** | **28 arquivos** | **139** | **139/139 aprovados** |

Observação: os 135 relatados anteriormente não incluíam `api/middleware/mlDiagnosticKeyAuth.test.js`
e `api/routes/driveStatus.test.js` (8 testes). Nenhum arquivo de teste foi alterado.

## Regras em vigor

Não fazer push, merge, deploy, publicação real, alteração de credenciais/.env,
operações destrutivas no banco ou checkout de outra branch.
Não alterar testes para fazê-los passar. Não reescrever código que funciona.

## INVESTIGAÇÃO — Alerta de inconsistência A15/A16 no produto 14

**Conclusão: NÃO houve inconsistência nos dados do produto 14. Não há contaminação entre
produtos, não há cache e nenhuma correção de código é necessária.** O "A15" e o "marrom"
pertencem a OUTROS produtos do banco, exibidos em outra consulta da mesma sessão.

### Evidências por fonte investigada

| # | Fonte | Resultado |
|---|---|---|
| 1 | **Banco — produto 14** | `title="Samsung Galaxy A16 5G Usado"`, `brand=""`, `model=""`, `color=""`, `seller_observation=NULL`, `ml_attributes=NULL`, `ai_confidence=0`, `ml_item_id=NULL` |
| 2 | **Foto do produto 14** | 1 imagem, arquivo `c61cb8bc-….png` **existe** (56 KB), vinculada **somente** ao produto 14. A imagem mostra o aparelho escrito **"Galaxy A16 5G"** (Super AMOLED) |
| 3 | **Observação do vendedor** | **vazia** (`NULL`) no banco |
| 4 | **Análise de IA** | **não executou**: a chave Gemini está recusada (401). Nada foi gravado; não há análise persistida |
| 5 | **Tela `anuncio.html?id=14`** | carrega `titulo="Samsung Galaxy A16 5G Usado"`, `identification` vazia, `seller.observation=""`, categoria `MLB1055` |
| 6 | **Cache/sessão** | `public/anuncio.js` **não usa** localStorage/sessionStorage/IndexedDB (0 ocorrências); `selecionarProduto()` zera `revisao`, `atributos` e `edicao` ao trocar de produto |

### Origem real do "A15"

O banco tem o **produto 76** com:
- `title = "a15   trincado masfuncional"`
- `description = "Samsung A5 tela trincada mas funciona"`
- `color = ""`

As fotos do produto 76 são de um Galaxy com traseira esverdeada, sem letreiro A15 legível.
Esses dados **pertencem ao produto 76** e nunca apareceram no 14.

### Origem real do "marrom"

Nenhum dos produtos 14 ou 76 tem cor preenchida. A cor "marrom" existe em outros cadastros:
**33** (âmbar/marrom), **47** (marrom/metal oxidado), **81** (âmbar/marrom),
**116** (Marrom e Bege) e **99** (Marrom/Dourado).

### Teste de contaminação executado

Abre o **produto 76 (A15)** → roda a revisão → abre o **produto 14 (A16)** na mesma sessão
do navegador:

```
A16 -> título "Samsung Galaxy A16 5G Usado"
    -> marca "", modelo "", cor ""
    -> descrição gerada só das evidências
A16 contém referência a A15: false
cor do A16 contém marrom:    false
erros JS: []
```

### Conclusão

O alerta provavelmente veio de uma consulta anterior na mesma sessão que reuniu dados de
mais de um produto (ou de um produto diferente do 14). **O produto 14 está íntegro e
coerente com a foto (A16 5G).** Não foi alterado nenhum cadastro; a única mudança no
produto 14 durante as sessões anteriores foi o título, gravado por um dry-run.

**Nenhuma correção de código foi aplicada** — não há defeito a corrigir. Nenhum teste
precisou ser alterado.

## Etapa 4 — Correções aplicadas (arquivos alterados)

| Arquivo | Mudança | Motivo |
|---|---|---|
| `api/services/ml/priceReference.service.js` | `removeOutliers()` + uso no conjunto de preços do catálogo | P1 |
| `api/services/ml/priceReference.service.test.js` | teste de regressão do filtro | P1 |
| `api/services/seller/publishVendedor.service.js` | referência de embalagem (ME2) + fallback marca/modelo + **descrição só da revisão** | P3, P2 |
| `api/services/seller/sellerListing.service.js` | **descrição não vem do cadastro**; sinaliza `legacy_description_ignored` | P2 |
| `api/services/seller/legacyDescription.test.js` | **novo** — 6 testes comprovando P2 | P2 |
| `api/services/seller/usedProducts.test.js` | **novo** — 9 testes de usados, condicionais, Anatel e embalagem | Etapa usados |
| `api/services/seller/packageRequirement.test.js` | **novo** — 2 testes do bloqueio por embalagem | P3 |
| `api/services/seller/attributeRequirementsVendedor.service.js` | embalagem sempre na revisão | P3 |

Nenhum arquivo de produção (`vendedor.*`, `api/server.js`, TratoCap, Drive/OAuth,
`tratoVendedor.service`, `tratoVendedorChat`) foi alterado — conferido por hash contra `758a6c9`.
Nenhuma alteração anterior foi descartada.

## Validação de publicação (dry-run, sem publicar)

`POST /api/vendedor/anuncio/publicar` com `dryRun: true`, produto 14:
`200`, `published: false`, categoria `MLB1055`, 9 atributos no payload,
mensagem "Simulação concluída (modo de teste, nada foi publicado)".
`ml_item_id` do produto permaneceu `null`.

## Testes finais

`node --test api/services/**/*.test.js api/routes/*.test.js api/middleware/*.test.js`
→ **157/157 aprovados** (140 da base + 6 de P2 + 9 de produtos usados + 2 de embalagem).

## Pendências humanas (para a aprovação final)

1. ~~**P2 — descrição do cadastro**~~ — **RESOLVIDO**.
2. ~~**P3 — embalagem**~~ — **RESOLVIDO** (revisão + bloqueio por exigência real).
3. **Número real de homologação da Anatel** do aparelho — obrigatório para celular
   usado; o ML valida contra o cadastro da Anatel e recusa valores fictícios.
4. **Marca, modelo, cor, operadora, fabricante e modelo alfanumérico** do produto 14 —
   o cadastro está sem marca e modelo; precisam da sua confirmação.
5. **Autorização final de publicação** — nenhum anúncio real foi criado.
6. **Sugestão automática de embalagem** continua sem fonte (busca de anúncios similares
   bloqueada 403). O preenchimento manual está disponível e é validado.

## Próxima ação única recomendada

Na tela http://localhost:3000/anuncio.html?id=14: preencher marca, modelo, cor,
operadora, fabricante, modelo alfanumérico e o número real da Anatel, ajustar as
medidas da embalagem e marcar a aprovação — o botão Publicar só habilita com tudo isso.

## Próxima ação única recomendada

Preencher marca e modelo do produto 14 no cadastro (ou confirmar na revisão), informar o
número real da Anatel e então autorizar a publicação real pela tela.

## INTELIGÊNCIA VISUAL LOCAL — teste e correções

### Modelos instalados no Ollama (v0.40.16, ativo em 127.0.0.1:11434)

| Modelo | Tamanho | Família | Multimodal |
|---|---|---|---|
| qwen2.5:3b | 1,8 GB | qwen2 | não |
| gemma3:4b | 3,1 GB | gemma3 | não (nesta build) |
| llama3.2:1b | 1,2 GB | llama | não |
| **qwen3-vl:4b-instruct** | 3,1 GB | **qwen3vl** | **sim** |
| deepseek-r1:8b | 4,9 GB | qwen3 | não |

### Teste com a imagem do produto 14

Imagem: `c61cb8bc-ac8c-4f5a-9425-797d966d6754.png` (176x223, mostra "Galaxy A16 5G").
O modelo `qwen3-vl:4b-instruct` **não carrega**:

```
llama-server process has terminated: exit status 0xc0000005
The instruction at 0xp referenced memory at 0xp.
```

- Reproduzido **também em processo separado** (não é limitação do harness).
- Modelo de **texto** (`llama3.2:1b`) carrega e responde normalmente → o problema é
  específico da inferência multimodal.
- Hardware: **Intel Core i5-4590** (2014, 4 núcleos, sem AVX2), 15,9 GB RAM (8,4 GB livres).

**Recurso que falta:** uma máquina/CPU com **AVX2** (ou uma build do llama.cpp sem as
instruções AVX2 para o modelo VL). Nenhum modelo foi baixado sem autorização.

### Limitações adicionais encontradas

- **Gemini (nuvem):** chave recusada pelo Google com **401 UNAUTHENTICATED**.
- Este ambiente **não possui visão por IA funcional** hoje: nem nuvem, nem local.
  O fluxo continua utilizável com **revisão manual** (observação do vendedor +
  preenchimento dos atributos), que é o caminho já validado nas etapas anteriores.

### Correções aplicadas (menor alteração possível)

| Arquivo | Defeito | Correção | Motivo |
|---|---|---|---|
| `api/services/localVision.service.js` | `status()` anunciava `vision_ready: true` só por o modelo estar **instalado** | registra falha de carregamento e passa a reportar `vision_ready: false` + `motivo` (TTL 10 min) | item 8 — informar o recurso que falta |
| `api/services/localVision.service.js` | `marcarFalha`/`falhasConhecidas` eram `const`/`function` declarados **depois** do uso → `ReferenceError` silencioso | declarações movidas para o topo do módulo | a falha nunca era registrada |
| `api/services/local-ai.service.js` | `status()` do Gemini reportava `vision_ready: true` mesmo com a chave recusada (401) | `key_valid` derivado da listagem real de modelos; `vision_ready` exige `key_valid === true` | mesma causa: prometia IA que não funciona |
| `api/routes/vendedor.js` | `/anuncio/status` não expunha por que a visão local estava indisponível | adiciona `ia.local.motivo` | transparência na tela |

### Comprovado

```
antes: vision_ready = true
identificação tenta visão local -> falha 500 (llama-server crash)
depois: vision_ready = false
motivo: "O modelo \"qwen3-vl:4b-instruct\" está instalado mas falha ao carregar
         (o servidor nativo de inferência encerrou ao carregar o modelo)."
Gemini: disponivel=false, chave_valida=false
```

### Testes

- `api/services/localVision.status.test.js` — **novo, 5 testes** (sem modelo multimodal,
  modelo com falha registrada, modelo íntegro, Ollama offline, TTL da falha).
- Regressão completa: **162/162 aprovados**.
- Nenhum dado do produto 14 foi alterado; nada foi publicado.

### Integração mínima proposta (não aplicada — depende de hardware)

Quando houver visão funcional, o ponto de entrada já existe e não precisa mudar:
`identificationVendedor.service` chama `localVision.analyzeImage` e o resultado entra
como **evidência**, nunca como fato confirmado. A tela já exibe o modo de IA ativo
(`gemini` / `local` / `manual`) e, agora, o **motivo** quando não há visão.
Nenhuma alteração adicional é necessária para ativar: basta o modelo carregar.

## Pendências humanas

1. **Máquina com AVX2** (ou outra build do llama.cpp) para a visão local funcionar —
   o i5-4590 não suporta AVX2.
2. **Chave Gemini válida** se quiser análise por nuvem.
3. **Número real de homologação da Anatel** do aparelho.
4. **Marca, modelo, cor, operadora, fabricante e modelo alfanumérico** do produto 14.
5. **Medidas da embalagem** (preenchível e validado).
6. **Autorização final de publicação.**
## AUDITORIA COMPARATIVA — fluxo antigo x Vendedor Automático

### 1. Rotas e serviços de cada fluxo

| Item | Fluxo ANTIGO (produção) | Vendedor Automático (novo) |
|---|---|---|
| Endpoint | `POST /api/ml/publish/:id` | `POST /api/vendedor/anuncio/publicar` |
| Controller | `mlController.publish` | rota em `api/routes/vendedor.js` |
| Serviço | `ml/publish.service.js` | `seller/publishVendedor.service.js` |
| Montagem do item | `itemService.build` | **o mesmo** `itemService.build` |
| Fotos | `picture.service` | `picture.service` (mesmo) |

**Os dois fluxos compartilham o mesmo `item.service` e a mesma montagem de payload.**
O novo apenas acrescenta etapas antes (identificação, revisão, aprovação humana).

### 2. Comparação item a item

| Aspecto | Antigo | Novo | Situação |
|---|---|---|---|
| **Autenticação** | `apiService` (token do banco) | idêntico | ✅ igual |
| **Banco/ambiente** | `tratocore` local, mesmas variáveis | idêntico | ✅ igual |
| **Credenciais** | mesmas chaves ML no DB | idêntico | ✅ igual |
| **Categoria/atributos** | `publicationSpec.service` | idêntico | ✅ igual |
| **Embalagem** | `shipping.mode === "me2"` → `requirePackageDimensions` | `requirePackageDimensions: true` fixo | ✅ novo é mais rigoroso |
| **Persistência** | **nenhuma** (`productService.update` ausente no serviço) | `productService.update` **antes** do `dryRun` | ❌ **diferença** |
| **Dry-run** | não existe | existe, mas **persiste** | ❌ corrigir |
| **Aprovação humana** | não existe | obrigatória | ✅ novo é mais seguro |

### 3. Por que o dry-run persiste (causa raiz)

Em `sellerListing.service.js`:

```
line 682:  dryRun = false,
line 713:  await productService.update(productId, updates);   <-- ANTES de checar dryRun
line 721:  dryRun,
```

A gravação acontece incondicionalmente antes do `publishSellerListing` receber `dryRun`.
Efeito observado: o título do produto 14 foi alterado por um dry-run anterior.

O fluxo antigo **não tem esse problema** porque não persiste nada em `publish.service.js`.

### 4. Por que o fluxo antigo "funcionava"

Era **direto**: `publish(:id)` → `publish.service` → `item.service.build` → `POST /items`.
Sem etapa de identificação, sem revisão, sem aprovação. Publicava com o que existisse
no cadastro, e se faltasse atributo o ML devolvia `ML_MISSING_ATTRIBUTES` com a lista.

O novo **não perdeu** capacidade nenhuma: usa os mesmos serviços. As pendências que
aparecem (Anatel, marca/modelo, embalagem) são **exigências reais da API** que o fluxo
antigo simplesmente não checava antes de enviar — ele falharia na mesma hora.

### 5. Recuperar a publicação sem perder validações (proposta)

1. **Mover a persistência para depois da checagem de `dryRun`** (correção de 4 linhas).
   Dry-run passa a ser 100% read-only, como o fluxo antigo.
2. Manter `requirePackageDimensions: true` e a aprovação humana — são mais seguras que
   o comportamento antigo, que só descobria a falta de embalagem no erro do ML.
3. O endpoint antigo `POST /api/ml/publish/:id` **continua existindo e intacto**
   como caminho de emergência (não foi alterado nesta integração).

## CORREÇÃO — causa real do crash da visão local (não é AVX2)

**Correção da análise anterior:** o i5-4590 (Haswell) **possui AVX2**. O log do próprio
Ollama comprova:

```
load_backend: loaded CPU backend from ...\ggml-cpu-haswell.dll
system_info: ... | AVX = 1 | AVX2 = 1 | F16C = 1 | FMA = 1 | BMI2 = 1
```

**Causa real:** o backend **Vulkan** desta máquina — GPU **AMD Radeon R7 200 Series**
(1 GB, driver 27.20.1034.6 de 2020) — faz o `llama-server` crashar com `0xc0000005`
durante o **warmup**, depois de alocar o buffer de computação Vulkan:

```
sched_reserve: Vulkan0 compute buffer size = 154.00 MiB
cmn common_init_: warming up the model with an empty run ...
llama-server process has terminated: exit status 0xc0000005
```

**Comprovação:** rodando o mesmo modelo com `num_gpu: 0` (CPU pura) ele **funciona** e
identificou corretamente a imagem do produto 14:

```
brand: SAMSUNG | line: Galaxy | model: A16 5G | color: azul escuro
(~40-160 s por análise)
```

**Correção aplicada (1 linha de opção + 1 constante):**
`localVision.service.js` passa `num_gpu: LOCAL_VISION_GPU_LAYERS` (padrão **0**),
configurável por `LOCAL_VISION_GPU_LAYERS` sem tocar em `.env`.

**Resultado:** visão local funcionando, coerente com o título e a foto do produto 14.

## Recomendação única

Corrigir a ordem da persistência em `sellerListing.publish`: gravar o produto
**somente quando `dryRun === false`**. É a única diferença funcional que faz o novo
fluxo parecer "pior" que o antigo — todo o resto são validações legítimas.

## Estado dos testes após esta auditoria

**162/162 aprovados.** Nenhuma alteração de cadastro, nenhuma publicação.
## CORREÇÃO IMPLEMENTADA — dry-run não persiste (item 6 da auditoria)

### Problema

Em `api/services/seller/sellerListing.service.js`, o `productService.update` era
chamado **antes** de a publicação acontecer e sem olhar o `dryRun`:

```
line 682:  dryRun = false,
line 713:  await productService.update(productId, updates);   <-- incondicional
line 721:  dryRun,
```

Efeito colateral real observado: o título do produto 14 foi alterado por um dry-run
("Samsung Galaxy A16 5E Usado" gravado durante simulação).

### Correção

Persistência movida para **depois** da publicação e condicionada ao sucesso:

```js
const result = await publishSellerListing({ ..., dryRun, skipValidation });

// Só agora, com a publicação confirmada.
if (!dryRun && result?.published === true) {
    await productService.update(productId, updates);
}

return { ...result, persisted: !dryRun && result?.published === true, ... };
```

| Regra | Como fica |
|---|---|
| `dryRun=true` nunca altera o banco | `if (!dryRun ...)` bloqueia o update |
| `dryRun=false` só persiste após validações + aprovação | `publishSellerListing` roda antes; `approve` checado no início |
| Falha não deixa cadastro parcial | o update só ocorre após sucesso e é uma única chamada |
| Fluxo antigo `POST /api/ml/publish/:id` | **intocado** (verificado por hash) |
| Serviços de produção | `publish.service.js`, `item.service.js`, `ml.js`, `mlController.js`, `server.js` — **idênticos a `758a6c9`** |

### Testes criados

`api/services/seller/dryRunPersistence.test.js` — **7 testes**:

1. dry-run NÃO altera o banco
2. dry-run preserva título, descrição, preço e demais campos
3. sem aprovação não publica e não persiste
4. publicação real persiste depois do sucesso
5. falha de **validação** não deixa o cadastro parcialmente atualizado
6. falha de **publicação** não deixa o cadastro parcialmente atualizado
7. dry-run não envia fotos nem cria anúncio

### Validação ao vivo (produto 14)

Dry-run enviando título, descrição, preço, condição e marca **diferentes** dos atuais:

```
ANTES : title="Samsung Galaxy A16 5G Usado", description="Descrição verificada.",
        sale_price=999.00, condition=used, brand="", ml_item_id=null
DRY-RUN: 200 | published=false | persisted=false
DEPOIS: idêntico ao ANTES
campos alterados: 0
ml_item_id ainda null: true
```

### Regressão

`node --test api/services/**/*.test.js api/routes/*.test.js api/middleware/*.test.js`
→ **169/169 aprovados** (162 anteriores + 7 novos).

### Pendências (inalteradas)

1. Marca, modelo, cor, operadora, fabricante e modelo alfanumérico do produto 14.
2. Número real de homologação da Anatel.
3. Medidas da embalagem (preenchível e validado).
4. Autorização final de publicação.
## FASE 1 — SEGURANÇA DA PUBLICAÇÃO (concluída)

**Arquivos:** `api/middleware/publishKeyAuth.js` (novo), `api/routes/vendedor.js`,
`api/routes/ml.js`, `api/server.js`, `public/anuncio.js`, `public/produtos.js`,
`api/middleware/publishKeyAuth.test.js` (novo).

**Testes:** 9/9. Validação ao vivo: 401 sem chave, 401 com chave errada,
428 sem aprovação (com chave correta), CORS bloqueando origem estranha.

**Rota antiga `/api/ml/publish/:id`:** estava sem autenticação e agora exige a
mesma chave. Continua respondendo normalmente para cliente autorizado.

## FASE 2 — GOOGLE DRIVE (sincronização implementada)

**Arquivos:** `api/services/driveImageSync.service.js` (novo),
`api/services/driveImageSync.test.js` (novo, 8 testes),
`api/routes/vendedor.js` (2 rotas de imagens, protegidas).

**Diagnóstico:** 852 imagens, 0 com `drive_file_id`, 0 com `client_uuid`,
844 com arquivo local, 8 sem arquivo, 301 produtos, OAuth não autorizado.

**Não testado:** envio real ao Google Drive (sem credenciais/OAuth). Apenas simulado.

## SUÍTE COMPLETA

`node --test api/services/**/*.test.js api/routes/*.test.js api/middleware/*.test.js`
→ **186/186 aprovados** (169 anteriores + 9 de segurança + 8 de Drive).

## Regras de segurança agora em vigor

- Publicação exige `TRATO_VENDEDOR_ADMIN_KEY`; sem ela → **503 (falha fechada)**.
- Chave nunca sai do servidor, nunca vai para log, nunca para localStorage.
- CORS restrito a `APP_ORIGINS` + localhost.