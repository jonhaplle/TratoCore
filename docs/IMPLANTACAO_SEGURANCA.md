# PROCEDIMENTO DE IMPLANTAÇÃO — Segurança da publicação

Commit preparado: **`935ebdd`** (pai `a8a96e6`, base de produção `758a6c9`).
Branch: `feature/integracao-vendedor-automatico`.
**Nada foi enviado ao remoto. Nenhum deploy. Nenhuma publicação.**

---

## 1. O que o commit entrega

23 arquivos, 2.943 inserções, 50 remoções. O `.env` **não** está incluído
(verificado por hash antes e depois do commit).

### Segurança (prioridade)

| Arquivo | Mudança |
|---|---|
| `api/middleware/publishKeyAuth.js` | **novo** — autorização única de publicação |
| `api/middleware/publishKeyAuth.test.js` | **novo** — 9 testes |
| `api/routes/ml.js` | rota antiga `/publish/:id` protegida (diff de 2 linhas) |
| `api/routes/vendedor.js` | `anuncio/revisao`, `anuncio/publicar` e `imagens/*` protegidas |
| `api/server.js` | CORS restrito por `APP_ORIGINS` (nunca `*`) |
| `public/anuncio.js`, `public/produtos.js` | enviam a chave no header; pedem a chave em 401/503 |

### Vendedor Automático (já validado nas etapas anteriores)

Rotas de anúncio, telas, descrição por evidências, dry-run sem persistência,
embalagem ME2, filtro de preço, separação de atributos, sincronização Drive.

---

## 2. Testes aprovados

### Automatizados
```
node --test api/services/**/*.test.js api/routes/*.test.js api/middleware/*.test.js
-> 186/186 aprovados
```

### Obrigatórios, ao vivo (servidor real, PORT isolada)

| # | Teste | Esperado | Obtido |
|---|---|---|---|
| 1 | Publicar sem chave | 401 | **401** ✅ |
| 2 | Publicar com chave incorreta | 401 | **401** ✅ |
| 3 | Chave correta sem `approve` | 428 | **428** ✅ |
| 4 | Rota antiga sem chave | 401 | **401** ✅ |
| 5 | Rota antiga com chave | passa do auth | 500 (produto inexistente) ✅ |
| 6 | Origem não autorizada | bloqueada | **allow-origin ausente** ✅ |
| 7 | Chave ausente no servidor | 503 | **503** ✅ |
| 8 | Rota antiga sem chave configurada | 503 | **503** ✅ |

### CORS com `APP_ORIGINS`
```
APP_ORIGINS=https://tratocore.onrender.com
  https://tratocore.onrender.com  -> permitido
  https://evil.example            -> bloqueado
sem APP_ORIGINS (dev)
  http://localhost:3000           -> permitido
  http://localhost:3102           -> bloqueado
```

A tela é servida pela **mesma origem** do servidor, portanto o navegador não exige
cabeçalho CORS para ela. O bloqueio afeta apenas chamadas de outras origens — correto.

---

## 3. Dependências

- **Nenhuma dependência nova.** `publishKeyAuth` usa apenas `crypto` (nativo).
- Variáveis já configuradas no Render:
  - `TRATO_VENDEDOR_ADMIN_KEY` — confirmada ativa (prova: `/handoffs` responde 401, não 503).
  - `APP_ORIGINS` — configurada; só terá efeito após o deploy.
- Valores **não** foram acessados nem exibidos.

---

## 4. Riscos remanescentes

| # | Risco | Situação |
|---|---|---|
| R1 | `.env` versionado com credenciais reais (histórico) | **NÃO resolvido** — exige rotação de chaves e limpeza de histórico (plano separado) |
| R2 | Produção ainda em `758a6c9` — CORS `*` e `/api/ml/publish/:id` sem auth | **ATIVO até o deploy** |
| R3 | 852 imagens sem `drive_file_id` | Publicação com foto falha no Render |
| R4 | OAuth do Drive não autorizado | Sincronização de fotos parada |
| R5 | 8 imagens sem arquivo local | Precisam ser reenviadas |
| R6 | Produto 112 com dados contaminados ("Samsung / Galaxy A15 / Marrom") | Não alterado, aguarda decisão |
| R7 | Gemini com chave recusada (401) | Cai para visão local/manual |

**Sobre R1:** o `.env` já estava versionado **antes** desta integração. Este commit
não o inclui nem o altera. A rotação é necessária, mas é uma operação separada e
delicada (invalida sessões e exige atualizar o Render) — não deve ser misturada com
este deploy de segurança.

---

## 5. Procedimento exato de implantação

Executar **somente após autorização explícita**. Nenhum passo abaixo foi executado.

```powershell
cd C:\TratoCore

# 1. Confirmar que o ponto de partida é o commit preparado
git log --oneline -1          # deve mostrar 935ebdd Seguranca de publicacao...

# 2. Enviar a branch de integração
git push -u origin feature/integracao-vendedor-automatico

# 3. Mesclar em main (a produção é servida a partir de main)
git switch main
git pull origin main
git merge --no-ff feature/integracao-vendedor-automatico -m "Merge: seguranca de publicacao + Vendedor Automatico"

# 4. Enviar main (isto dispara o redeploy automático no Render)
git push origin main
```

### Verificação obrigatória após o deploy (≈3-5 min)

```powershell
# a) confirmar que a versão nova está no ar
(Invoke-RestMethod https://tratocore.onrender.com/api/version).commit
#    deve mostrar 935ebdd ou o commit de merge

# b) rotas novas existem
Invoke-WebRequest https://tratocore.onrender.com/api/vendedor/anuncio/status   # 200

# c) segurança ativa
#    POST /api/vendedor/anuncio/publicar sem chave  -> 401
#    POST /api/ml/publish/999999999 sem chave       -> 401  (antes era 500)
#    CORS com Origin: https://evil.example          -> sem allow-origin

# d) telas continuam carregando
#    https://tratocore.onrender.com/produtos.html   -> 200
#    https://tratocore.onrender.com/anuncio.html    -> 200
```

### Rollback (se algo quebrar)

```powershell
git switch main
git revert -m 1 <commit-de-merge> --no-edit
git push origin main
```
O Render redeploya a versão anterior. Nenhum dado é afetado (o merge não altera banco).

---

## 6. Atenção antes do passo 3

O deploy **ativa** a exigência de chave na publicação. A tela `produtos.html` já pede
a chave em 401/503 — mas o vendedor precisa **ter** a chave em mãos. Confirme que
`TRATO_VENDEDOR_ADMIN_KEY` está acessível a você antes de autorizar o merge.

## Próxima ação

**Autorizar a sequência `push` → `merge` → `push main`**, ou indicar ajustes.
Enquanto não autorizado, a produção permanece com o risco R2 ativo.
