# RELATÓRIO — Prontidão do Vendedor Automático para publicação

Data: 2026-11-12. Branch `feature/integracao-vendedor-automatico`, HEAD `a8a96e6`, base de produção `758a6c9`.
**Nenhum anúncio foi publicado. Nenhum push/merge/deploy realizado.**

---

## 1. Estado do Git (alterações preservadas)

12 arquivos com alterações não commitadas + 1 documento. Nada foi descartado.

```
 M api/routes/vendedor.js
 M api/services/local-ai.service.js
 M api/services/localVision.service.js
 M api/services/ml/priceReference.service.js
 M api/services/ml/priceReference.service.test.js
 M api/services/seller/attributeRequirementsVendedor.service.js
 M api/services/seller/publishVendedor.service.js
 M api/services/seller/sellerListing.service.js
?? api/services/localVision.status.test.js
?? api/services/seller/dryRunPersistence.test.js
?? api/services/seller/legacyDescription.test.js
?? api/services/seller/packageRequirement.test.js
?? api/services/seller/usedProducts.test.js
?? docs/RETOMADA_TESTES.md
```

---

## 2. O que JÁ está integrado (verificado, não presumido)

| Requisito do fluxo | Estado | Evidência |
|---|---|---|
| Rota montada no server | ✅ | `app.use("/api/vendedor", vendedorRoutes)` |
| Tela `anuncio.html` + `anuncio.js` + `anuncio.css` | ✅ | 12 KB / 52 KB / 15 KB em `public/` |
| Botão "Revisar e publicar" em `produtos.js` | ✅ | linhas 151 e 823 |
| IA identifica produto | ⚠️ | nuvem 401; **local funciona** (CPU) |
| Título comercial | ✅ | `listingCopy.buildTitle` com limite da categoria |
| Descrição voltada à venda | ✅ | só evidências (regra P2) |
| Preço recomendado | ✅ | catálogo ML + outliers filtrados |
| Categoria | ✅ | `MLB9206 Canecas` para o produto 112 |
| Atributos obrigatórios | ✅ | pede só o que falta (`Material`) |
| Peso/dimensões | ✅ | preenchível + exigido no payload |
| Revisar/editar | ✅ | validado no navegador |
| Aprovação humana | ✅ | `428 ML_APPROVAL_REQUIRED` sem `approve` |
| Publicar pela API oficial | ✅ | `item.service` + `picture.service` |
| Retornar ID + permalink | ✅ | `item_id` / `permalink` |

**Teste real (produto 112 — caneca, NÃO o 14):**

```
sem aprovação            -> 428 ML_APPROVAL_REQUIRED
com aprovação, faltando  -> 422 ML_MISSING_ATTRIBUTES (só "Material")
com tudo preenchido      -> 200 dryRun | published=false | persisted=false
atributos no payload     -> 10
embalagem no payload     -> 4 medidas
campos alterados no banco-> 0
```

---

## 3. Bloqueios reais para produção

### B1 — FOTOS: nenhuma imagem está no Google Drive (CRÍTICO)

- **852 imagens** no banco, **todas** com `drive_sync_status = "pending"` e `drive_file_id = NULL`.
- `picture.service.js` exige arquivo local **ou** `drive_file_id`; no Render o disco é **efêmero**.
- `render.yaml` **não declara `disk:`** persistente.
- **Consequência:** no Render, `Imagem não encontrada localmente` ao publicar.
- **Não é regressão nova:** o fluxo antigo `POST /api/ml/publish/:id` tem exatamente a mesma
  dependência. Sem Drive ou disco persistente, **nenhum** fluxo publica fotos no Render.

### B2 — `/api/vendedor/anuncio/publicar` sem autenticação (SEGURANÇA, CRÍTICO)

- A rota exige apenas `approve: true` no corpo.
- `app.use(cors())` está **aberto** (qualquer origem).
- **Consequência:** qualquer pessoa que descubra a URL pode publicar anúncios reais na conta.
- **Correção sugerida (não aplicada — requer sua autorização):** exigir chave de admin
  (o padrão `TRATO_VENDEDOR_ADMIN_KEY` já existe para `/handoffs`) e restringir CORS.

### B3 — Credenciais no Git (SEGURANÇA, CRÍTICO, PRÉ-EXISTENTE)

- `.env` **está versionado** (blob no histórico), apesar de constar no `.gitignore`.
- Requer rotação de chaves e remoção do histórico — **fora do escopo desta integração**,
  nenhuma alteração feita.

### B4 — IA na nuvem indisponível

- Gemini: **401 UNAUTHENTICATED** (chave recusada).
- Visão local: **funciona na CPU** (`num_gpu: 0`), identificou "Samsung Galaxy A16 5G".
  No Render não há Ollama → cai para **modo manual** (fluxo continua utilizável).

### B5 — Cadastro contaminado do produto 112 (DADOS, não código)

- Produto 112 (caneca) está com `brand=Samsung`, `model=Galaxy A15`, `color=Marrom`
  e uma descrição de celular.
- **É aqui que aparece o "A15 / marrom".** Não é bug do fluxo: são dados antigos gravados
  no cadastro. O novo fluxo **não** inventa nada; ele apenas lê o cadastro.
- **Não alterei** (exige sua confirmação). Pode ser corrigido pela própria tela de revisão.

---

## 4. Migrações e produção

| Item | Situação |
|---|---|
| Colunas usadas pelo módulo | **todas existem** (verificado por `information_schema`) |
| `products.ml_attributes` | criada automaticamente no Render (`RENDER=true`) |
| `trato_vendedor_handoffs` | autocria via `CREATE TABLE IF NOT EXISTS` (só chat) |
| PostgreSQL | 17.10 local; sintaxe usada é compatível |
| Migração adicional necessária | **nenhuma** |

---

## 5. Dependências e configuração do Render

- Dependências: `express`, `pg`, `axios`, `dotenv`, `cors`, `cloudinary`, `sharp` — todas declaradas.
- Módulos novos usam apenas `fs`, `path`, `crypto` (nativos) + `axios`.
- Variáveis necessárias (valores **não** exibidos): `DB_*`, `ML_CLIENT_ID`, `ML_CLIENT_SECRET`,
  `ML_REDIRECT_URI`. Opcionais: `GEMINI_*`, `LOCAL_VISION_*`, `OLLAMA_URL`, `TRATO_VENDEDOR_ADMIN_KEY`.
- `localVision` desiste em 2,5 s quando não há Ollama → **não trava** o Render.
- `render.yaml` não declara disco persistente → ver **B1**.

---

## 6. Testes executados

```
node --test api/services/**/*.test.js api/routes/*.test.js api/middleware/*.test.js
-> 169/169 aprovados
```

Integração ao vivo (sem publicar): abertura de `produtos.html`, botão "Revisar e publicar",
`anuncio.html`, revisão completa, aprovação, dry-run `200`, `persisted=false`, banco inalterado.

---

## 7. Prontidão

| Item | Pronto? |
|---|---|
| Fluxo foto → anúncio → revisão → aprovação → publicação | ✅ **sim**, no código |
| Publicar no ambiente LOCAL | ✅ sim (fotos locais disponíveis) |
| Publicar no RENDER | ❌ **não** — B1 (fotos) |
| Seguro para expor em produção | ❌ **não** — B2 (rota aberta) |

---

## 8. Próxima ação única recomendada

**Autorizar a correção de B2** (exigir `TRATO_VENDEDOR_ADMIN_KEY` em `/anuncio/publicar`
e restringir CORS), pois é o único bloqueio que impede expor o recurso com segurança
e pode ser resolvido inteiramente no código, sem depender de infraestrutura.

Em paralelo, a decisão sobre B1 (disco persistente no Render **ou** sincronizar as 852
imagens para o Google Drive) é infraestrutura e depende de você.

---

# ATUALIZAÇÃO — FASE 1 (segurança) e FASE 2 (Drive) — 2026-11-12

## FASE 1 — CONCLUÍDA E TESTADA

### Arquivos criados/alterados

| Arquivo | Mudança |
|---|---|
| `api/middleware/publishKeyAuth.js` | **novo** — autorização única para publicar |
| `api/routes/vendedor.js` | `/anuncio/revisao`, `/anuncio/publicar` e as 2 rotas novas de imagens passam a exigir a chave |
| `api/routes/ml.js` | rota antiga `/publish/:id` passa a exigir a mesma chave |
| `api/server.js` | CORS restrito (sem `*`) |
| `public/anuncio.js` | envia a chave no header; pede a chave em 401/503 |
| `public/produtos.js` | idem para a rota antiga |
| `api/middleware/publishKeyAuth.test.js` | **novo** — 9 testes |

### Regras de segurança implementadas

- Chave comparada **somente no servidor** (`crypto.timingSafeEqual`).
- **Nunca** devolvida em resposta, nunca enviada ao navegador, nunca registrada em log.
- A chave digitada na tela fica **apenas em memória** (`window.__chavePublicacao`), não vai para localStorage.
- Sem `TRATO_VENDEDOR_ADMIN_KEY` configurada a publicação fica **desabilitada (503)** — falha fechada.
- CORS: apenas `APP_ORIGINS` (env) + localhost/127.0.0.1:3000 e :3080. Sem wildcard.

### Testes (9/9) e validação ao vivo

```
sem chave                    401 UNAUTHORIZED
chave errada                 401 UNAUTHORIZED
chave correta sem approve    428 ML_APPROVAL_REQUIRED
CORS origem estranha         allow-origin ausente (bloqueado)
CORS localhost:3000          permitido
```

### Outras rotas verificadas

| Rota | Situação |
|---|---|
| `POST /api/ml/publish/:id` | **estava sem autenticação** → agora protegida |
| `POST /api/vendedor/anuncio/publicar` | protegida |
| `POST /api/vendedor/anuncio/revisao` | protegida (custa IA) |
| `GET /api/vendedor/anuncio/status` | pública de propósito (só status) |
| `POST /api/vendedor/handoff` | pública (atendimento ao cliente) |
| `GET /api/vendedor/handoffs` | já exigia `TRATO_VENDEDOR_ADMIN_KEY` |
| `/api/tratocap/*` | inalterado (fora do escopo) |

## FASE 2 — INTEGRAÇÃO AUDITADA; SINCRONIZAÇÃO IMPLEMENTADA

### O que já existia (reutilizado, NÃO duplicado)

- `googleDriveOAuthService` — OAuth do Drive (única integração do projeto).
- `tratocapSyncQueue.service` — fila do TratoCap com `uploadBuffer` e `markSynced`.
- `picture.service` — já sabe usar `drive_file_id` para enviar fotos ao ML.

### Diagnóstico das 852 imagens

| Medida | Valor |
|---|---|
| Imagens no banco | 852 |
| Com `drive_file_id` | **0** |
| Com `client_uuid` | **0** |
| Status `pending` | 852 |
| Arquivos locais existentes | **844** |
| Arquivos locais ausentes | **8** |
| Produtos afetados | 301 |
| OAuth do Drive autorizado | **NÃO** (0 registros) |
| Credenciais Google no `.env` | **AUSENTES** |

**Por que a fila do TratoCap não resolve:** ela vincula por `client_uuid`,
que é `NULL` em todas as 852 imagens históricas. Por isso o novo serviço vincula
por `product_images.id`.

### Implementado

| Arquivo | Conteúdo |
|---|---|
| `api/services/driveImageSync.service.js` | **novo** — lista pendentes, envia UMA imagem, grava `drive_file_id`, resumo |
| `api/services/driveImageSync.test.js` | **novo** — 8 testes com Drive simulado |
| `api/routes/vendedor.js` | `GET /anuncio/imagens/status` e `POST /anuncio/imagens/sincronizar` (ambas protegidas) |

### Garantias do serviço (todas com teste)

- **Idempotente:** imagem com `drive_file_id` é ignorada → reprocessar não duplica.
- **Não apaga** arquivo local nem do Drive.
- **Só grava após o Drive confirmar** o identificador.
- **Dry-run por padrão:** apenas relata o que faria.
- **Não sai da pasta `storage`** (bloqueio de path traversal).
- Falha do Drive não grava nada e é registrada em `drive_sync_error`.

### O que NÃO foi testado (limitação honesta)

- **Nenhum envio real ao Google Drive foi executado**, porque o OAuth não está
  autorizado e as credenciais Google não existem no `.env`. O envio real foi
  validado apenas contra um Drive **simulado**.

## Situação para o Render

| Requisito | Situação |
|---|---|
| Código do fluxo | ✅ pronto |
| Segurança da publicação | ✅ pronta e testada |
| Fotos no Render | ❌ **bloqueado**: 0/852 no Drive |
| OAuth do Drive | ❌ **não autorizado** |
| `TRATO_VENDEDOR_ADMIN_KEY` | ❌ **precisa ser criada no Render** |
| `APP_ORIGINS` | ❌ **precisa ser definida com a URL do Render** |

## Procedimento seguro para sincronizar as 852 imagens

1. **Criar as credenciais Google** (Google Cloud Console → OAuth 2.0) e definir no
   Render: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
   `DRIVE_TOKEN_ENCRYPTION_KEY`. *(Alteração de ambiente — requer sua autorização.)*
2. Autorizar a conta em `/api/google-drive/oauth` e escolher a pasta `FOTOS`.
3. Rodar primeiro o **dry-run**:
   `POST /api/vendedor/anuncio/imagens/sincronizar` com `{ "limite": 5 }`
   (padrão já é `dryRun: true`).
4. Enviar um lote pequeno: `{ "limite": 5, "dryRun": false }` e conferir
   `enviadas` e `GET /anuncio/imagens/status`.
5. Repetir em lotes de 50 até `sem_drive` chegar a 0. Reprocessar é seguro
   (idempotente).
6. Investigar as **8 imagens sem arquivo local** — precisam ser reenviadas pelo
   TratoCap ou marcadas manualmente.

## Próxima ação única

**Autorizar a criação de `TRATO_VENDEDOR_ADMIN_KEY` e `APP_ORIGINS` no Render**
(e, em seguida, as credenciais Google) — sem elas, a publicação fica desabilitada
por segurança e as fotos continuam sem destino permanente.
---

# VERIFICAÇÃO DA SEGURANÇA EM PRODUÇÃO — 2026-11-12

Alvo: `https://tratocore.onrender.com`. Nenhuma chave foi solicitada, recebida ou impressa.

## RESULTADO GERAL: A SEGURANÇA NOVA **NÃO ESTÁ ATIVA** EM PRODUÇÃO

**Causa raiz:** o Render continua servindo o commit **`758a6c9`**.
O código de segurança (FASE 1) está apenas na branch local e **nunca foi implantado**.

```
GET /api/version  ->  commit: 758a6c9fd7b2802789c51a46b8941c6aa4626bcb
```

## Resultados teste a teste

| # | Teste | Esperado | Obtido em produção | Situação |
|---|---|---|---|---|
| 1 | Variáveis presentes | presente | ver abaixo | ⚠️ parcial |
| 2 | `POST /anuncio/publicar` sem auth | 401 | **404 Rota não encontrada** | ❌ rota não existe |
| 3 | `POST /anuncio/publicar` chave errada | 401 | **404 Rota não encontrada** | ❌ rota não existe |
| 4 | CORS origem não autorizada | bloqueada | **200 `access-control-allow-origin: *`** | ❌ **ABERTO** |
| 5 | Chave vaza em HTML/JS/logs | não | **nenhum vazamento** | ✅ |
| 6 | Serviço reiniciou com variáveis | sim | variável de handoffs carregada; código novo ausente | ⚠️ parcial |

## Detalhe do item 1 — as variáveis existem, mas não têm efeito

**`TRATO_VENDEDOR_ADMIN_KEY`: EXISTE no ambiente do Render.**
Prova observável: `GET /api/vendedor/handoffs` (rota que já existia em `758a6c9` e
usa essa variável) responde **401** em vez de 503:

```
sem chave   -> 401 {"success":false,"error":"Acesso não autorizado."}
chave falsa -> 401 {"success":false,"error":"Acesso não autorizado."}
```

Se a variável não existisse, a resposta seria `503 "Configure TRATO_VENDEDOR_ADMIN_KEY..."`.
Ou seja: **o valor está carregado no processo**. O que não existe é a rota que deveria usá-lo
para publicar — ela retorna 404 porque está só na branch local.

**`APP_ORIGINS`: configurada no dashboard, porém SEM EFEITO.**
O código em produção tem `app.use(cors())` sem lista de origens. Nenhuma variável é lida,
então qualquer origem é aceita:

```
GET http://.../api/vendedor/status  (Origin: https://site-malicioso.example)
-> 200 | access-control-allow-origin: *

OPTIONS preflight (origem estranha) -> 204
   allow-origin: *
   allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE
```

## ⚠️ RISCO ATIVO HOJE EM PRODUÇÃO

`POST /api/ml/publish/:id` **está sem autenticação** em produção:

```
POST /api/ml/publish/999999999  sem autenticação -> 500 {"error":"Produto não encontrado."}
POST /api/ml/publish/999999999  chave falsa      -> 500 {"error":"Produto não encontrado."}
```

O 500 (em vez de 401) prova que a requisição **chega ao controller** sem checagem de chave.
Combinado com `CORS: *`, qualquer pessoa pode disparar publicação de um produto real
da conta apenas conhecendo `POST /api/ml/publish/<id>`.

Usei um ID inexistente de propósito: a requisição falha antes de qualquer publicação.

## Item 5 — sem vazamento da chave (confirmado)

| Recurso | Bytes | Vazamentos |
|---|---|---|
| `/produtos.html` | 4.829 | nenhum |
| `/produtos.js` | 24.697 | nenhum |
| `/vendedor.html` | 5.522 | nenhum |
| `/vendedor.js` | 15.026 | nenhum |
| `/anuncio.html` | — | 404 (não implantado) |
| `/anuncio.js` | — | 404 (não implantado) |

Resposta de erro não cita a variável:
`{"success":false,"error":"Acesso não autorizado."}`

No código local, a chave fica **apenas** em `window.__chavePublicacao` (memória da página).
Não há `localStorage`, não há `TRATO_VENDEDOR_ADMIN_KEY` em nenhum arquivo do frontend.

## Correção necessária (NÃO aplicada — exige autorização)

Nenhuma alteração de configuração no Render resolve isso: **o problema é a ausência do
deploy**, não uma variável faltando. A correção é implantar o código da branch.

Sequência segura:

1. **Commitar** as alterações locais na branch `feature/integracao-vendedor-automatico`
   (20 arquivos, todas as fases anteriores).
2. **Push** da branch e **merge** em `main` (com sua autorização explícita).
3. Deixar o Render redeployar a `main`.
4. Repetir esta verificação e confirmar: 401 sem chave, 401 com chave errada,
   CORS bloqueando origem estranha, `GET /api/vendedor/anuncio/status` retornando 200.

Antes do passo 2, decidir sobre o **produto 112** (dados "Samsung / Galaxy A15 / Marrom"
numa caneca) — não alterado até agora por falta de autorização.

## Recomendação única

**Autorizar commit + push + merge em `main`** para que a correção de segurança chegue ao
Render. Enquanto isso não acontecer, a produção permanece com CORS aberto e a rota antiga
de publicação sem autenticação.