============================================================
TRATOBOOK
TratoCore — CÉREBRO OFICIAL DO PROJETO
============================================================

Versão: 3.0
Data: 09/08/2026

Projeto:
TratoCore / TratoBook

Autor:
Marco Aurélio Silva

Status:
EM DESENVOLVIMENTO

MISSÃO PRINCIPAL:
PUBLICAR O PRIMEIRO ANÚNCIO REAL NO MERCADO LIVRE.

============================================================
REGRA PRINCIPAL DO PROJETO
============================================================

O objetivo imediato é concluir a PRIMEIRA PUBLICAÇÃO REAL
utilizando exclusivamente a API Oficial do Mercado Livre.

Não iniciar:
- Shopee
- publicação em lote
- automações secundárias
- novas arquiteturas
- funcionalidades paralelas

antes da primeira publicação real.

Regra:

PRIMEIRO ANÚNCIO
        ↓
VALIDAR
        ↓
MVP CONCLUÍDO
        ↓
NOVAS FUNCIONALIDADES


============================================================
1. ARQUITETURA DO TRATOCORE
============================================================

Diretório principal:

C:\TratoCore

Stack:

Node.js
Express
PostgreSQL 17
OpenAI
Axios
Multer
Sharp
FormData
Mercado Livre OAuth
HTML
CSS
JavaScript

Servidor:

http://localhost:3000

API:

http://localhost:3000/api

Rotas principais:

/api/products
/api/upload
/api/ai
/api/product-images
/api/ml


============================================================
2. SERVIDOR
============================================================

Servidor Node funcionando.

Executável utilizado:

C:\Program Files\nodejs\node.exe

Inicialização conhecida:

"C:\Program Files\nodejs\node.exe" C:\TratoCore\api\server.js

Servidor:

http://localhost:3000

PostgreSQL:
CONECTADO

OpenAI:
A variável OPENAI_API_KEY é carregada pelo servidor,
porém a chave utilizada no teste da IA apresentou
erro HTTP 401 e precisa ser corrigida antes de usar
a análise com IA novamente.


============================================================
3. BANCO DE DADOS
============================================================

Banco:

tratocore

PostgreSQL:

17

Tabela principal de imagens:

product_images

Estrutura REAL confirmada:

id
product_id
file_name
original_url
thumb_url
mime_type
width
height
file_size
is_main
sort_order
created_at

Características:

id:
SERIAL PRIMARY KEY

product_id:
FK → products(id)

is_main:
BOOLEAN NOT NULL DEFAULT TRUE

sort_order:
INTEGER NOT NULL DEFAULT 1

created_at:
TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP

Foreign Key:

FOREIGN KEY (product_id)
REFERENCES products(id)
ON DELETE CASCADE

Índices confirmados:

idx_product_images_product
idx_product_images_main

A estrutura suporta:

Produto
 ├── Foto 1
 ├── Foto 2
 ├── Foto 3
 ├── Foto 4
 └── até 10 fotos


============================================================
4. SQL
============================================================

Existem arquivos SQL duplicados relacionados a
product_images.

Exemplos:

sql\001_create_product_images.sql
sql\004_product_images.sql

IMPORTANTE:

Não recriar a tabela sem necessidade.

A estrutura REAL deve sempre ser conferida diretamente
no PostgreSQL.

Estrutura atualmente utilizada pelo banco:

is_main
sort_order
file_name
mime_type
width
height
file_size


============================================================
5. BACKUPS
============================================================

Pasta:

C:\TratoCore\backup

Backups confirmados:

C:\TratoCore\backup\upload.js.antes-multifoto

C:\TratoCore\backup\index.html.antes-multifoto

C:\TratoCore\backup\app.js.antes-multifoto

Também existe:

C:\TratoCore\backup\app.js.antes-preview-ordem


REGRA:

Antes de alterar arquivo importante:

CRIAR BACKUP.


============================================================
6. UPLOAD
============================================================

Arquivo:

C:\TratoCore\api\routes\upload.js

Responsabilidades:

- receber imagem
- armazenar temporariamente
- copiar original
- gerar thumbnail
- remover temporário
- retornar URLs

Formatos permitidos:

image/jpeg
image/jpg
image/png
image/webp

Limite:

20 MB por arquivo

Pastas:

storage/originals
storage/thumbs
storage/temp

O upload.js foi validado com:

"C:\Program Files\nodejs\node.exe" --check
C:\TratoCore\api\routes\upload.js

Resultado:

SEM ERRO


============================================================
7. IMAGENS DE PRODUTO
============================================================

Arquivos:

api\routes\productImages.js
api\controllers\productImageController.js
api\services\productImageService.js
api\models\productImageModel.js

Rotas:

POST
/api/product-images

GET
/api/product-images/product/:productId

GET
/api/product-images/product/:productId/main

PUT
/api/product-images/product/:productId/main/:imageId

DELETE
/api/product-images/:id


Funções existentes:

create
getByProductId
getMainImage
setMainImage
remove


============================================================
8. FRONTEND
============================================================

Arquivo principal:

C:\TratoCore\public\index.html

Arquivo JavaScript:

C:\TratoCore\public\app.js

Página de produtos:

C:\TratoCore\public\produtos.html

O index.html foi reconstruído depois de ter ficado
incompleto durante uma edição.

Estrutura confirmada:

<!DOCTYPE html>
<html lang="pt-BR">

<head>
<meta charset="UTF-8">

...

<script src="app.js"></script>

</body>
</html>


============================================================
9. MULTIFOTO
============================================================

O campo de seleção de fotos possui:

multiple

Formatos:

image/jpeg
image/jpg
image/png
image/webp

Limite desejado:

10 fotos

Mensagem apresentada:

"Você pode selecionar até 10 fotos.
A primeira será usada como imagem principal."


Fluxo desejado:

Selecionar até 10 fotos
        ↓
Preview
        ↓
Foto 1 = Principal
        ↓
Upload
        ↓
Produto
        ↓
product_images


============================================================
10. ORDEM DAS FOTOS
============================================================

REGRA:

A ordem da seleção deve ser preservada.

Exemplo:

Foto selecionada 1
→ Principal
→ sort_order = 1
→ is_main = true

Foto selecionada 2
→ sort_order = 2
→ is_main = false

Foto selecionada 3
→ sort_order = 3
→ is_main = false

etc.


============================================================
11. INCIDENTE DO app.js
============================================================

Durante a implementação da multifoto houve um erro:

O conteúdo inteiro de:

C:\TratoCore\public\app.js

foi sobrescrito indevidamente pelo bloco:

photoInput.addEventListener(...)

Isso provocou no navegador:

Uncaught ReferenceError:
photoInput is not defined

O problema foi identificado pelo Console do Chrome.

O app.js foi restaurado usando:

Copy-Item
'C:\TratoCore\backup\app.js.antes-multifoto'
'C:\TratoCore\public\app.js'
-Force

Depois:

node --check

não apresentou erro.


============================================================
12. REGRA PARA ALTERAÇÃO DO app.js
============================================================

NUNCA substituir o app.js inteiro para fazer uma pequena
alteração.

Alterações futuras devem ser feitas somente no bloco
necessário.

Sempre:

1. backup
2. alteração
3. node --check
4. navegador
5. Console


============================================================
13. ESTADO DO PREVIEW MULTIFOTO
============================================================

A implementação pretendida utiliza leitura sequencial:

for
+
await new Promise

para preservar a ordem.

Objetivo:

seleção
 ↓
ordem preservada
 ↓
preview
 ↓
primeira foto = Principal

O último estado conhecido deve ser VALIDADO antes de
continuar.

Não assumir que está funcionando sem testar.


============================================================
14. IA / OPENAI
============================================================

Fluxo planejado:

Foto
 ↓
Upload
 ↓
OpenAI Vision
 ↓
Identificação do produto
 ↓
Título
 ↓
Marca
 ↓
Modelo
 ↓
Categoria
 ↓
Descrição
 ↓
Preço sugerido

Endpoint:

/api/ai/analyze

ESTADO:

A infraestrutura da IA existe.

Porém um teste do navegador retornou:

HTTP 401
Incorrect API key provided

Portanto:

IA = BLOQUEADA ATÉ CORRIGIR A API KEY.

Isso não deve ser confundido com o problema do
Mercado Livre.


============================================================
15. MERCADO LIVRE — ARQUITETURA
============================================================

Arquivos principais:

api\controllers\mlController.js

api\routes\ml.js

api\services\ml\oauth.service.js

api\services\ml\token.service.js

api\services\ml\api.service.js

api\services\ml\publish.service.js

api\services\ml\item.service.js

api\services\ml\picture.service.js

api\services\ml\mlProduct.service.js


Rotas:

GET
/api/ml/login

GET
/api/ml/callback

GET
/api/ml/me

POST
/api/ml/publish/:id

GET
/api/ml/health


============================================================
16. OAUTH — ESTADO ATUAL
============================================================

ATENÇÃO:

O OAuth NÃO é mais o bloqueio atual.

O problema de autorização que existia anteriormente foi
superado.

O TratoCore atualmente consegue:

- obter token
- armazenar token
- renovar token
- substituir access_token
- substituir refresh_token
- consultar /users/me


============================================================
17. TOKEN
============================================================

Access Token:

carregado do PostgreSQL.

Refresh Token:

armazenado no PostgreSQL.

O serviço de token possui renovação automática.

Quando o token expira:

ACCESS TOKEN EXPIRADO
        ↓
REFRESH TOKEN
        ↓
NOVO ACCESS TOKEN
        ↓
NOVO REFRESH TOKEN
        ↓
POSTGRESQL


============================================================
18. TESTE REAL DO MERCADO LIVRE
============================================================

Endpoint:

GET

http://localhost:3000/api/ml/me

Teste executado:

Invoke-RestMethod
'http://localhost:3000/api/ml/me'

RESULTADO:

SUCESSO

O Mercado Livre retornou a conta autenticada.

Confirmado:

user_id
site_id = MLB
user_type = normal
seller information
status da conta
etc.


CONCLUSÃO:

TOKEN → FUNCIONANDO

OAUTH → FUNCIONANDO

POSTGRESQL → FUNCIONANDO

/USERS/ME → FUNCIONANDO


============================================================
19. PROBLEMA ATUAL DO MERCADO LIVRE
============================================================

Foi testado:

GET

https://api.mercadolibre.com/sites/MLB/domain_discovery/search

Consulta:

Samsung Galaxy A36 256GB 8GB RAM

Resultado:

HTTP 403

Resposta:

{
  "message": "Unexpected error validating API access",
  "error": "Forbidden",
  "status": 403,
  "cause": "Forbidden"
}


IMPORTANTE:

Esse 403 ocorreu mesmo após o TratoCore obter/renovar
o token.

Portanto:

Não é simplesmente token expirado.

Também já foi confirmado:

/users/me → OK

domain_discovery → 403


============================================================
20. CATEGORY PREDICTOR
============================================================

O endpoint:

/sites/MLB/domain_discovery/search

é utilizado para descoberta/predição de categoria.

O TratoCore tentou utilizá-lo.

ESTADO:

CATEGORY PREDICTOR → 403

Portanto a categorização automática ainda NÃO está
liberada/funcionando através desse endpoint.

NÃO criar código definitivo em cima dessa chamada até
entender o motivo do 403 e/ou utilizar alternativa oficial.


============================================================
21. PRÓXIMO PASSO DO MERCADO LIVRE
============================================================

Não alterar OAuth.

Não alterar token.service.

Não alterar api.service.

Não alterar item.service sem necessidade.

Primeiro:

investigar o 403 do domain_discovery.

Depois:

obter category_id.

Depois:

consultar atributos da categoria.

Depois:

validar payload.

Depois:

publicar primeiro anúncio.


============================================================
22. PUBLICAÇÃO
============================================================

Fluxo atual:

Produto
 ↓
product_images
 ↓
picture.service
 ↓
POST /pictures/items/upload
 ↓
picture_id
 ↓
item.service
 ↓
POST /items
 ↓
Mercado Livre
 ↓
MLBxxxxxxxx
 ↓
Permalink
 ↓
Salvar no produto


============================================================
23. PICTURE SERVICE
============================================================

O picture.service deixou de ser MOCK.

As imagens utilizadas na publicação são locais.

Origem:

storage/originals

Fluxo:

storage/originals
        ↓
picture.service
        ↓
POST /pictures/items/upload
        ↓
picture_id
        ↓
item.service
        ↓
POST /items


============================================================
24. ITEM SERVICE
============================================================

O item.service já existe.

Ele possui tratamento para:

ml_category_id
family_name
listing_type_id
pictures
attributes
EMPTY_GTIN_REASON

Existe também tratamento específico para:

MLB191838

Categoria:

Pratos

Há atributos específicos implementados para essa categoria.


============================================================
25. LISTING TYPE
============================================================

Regra do projeto:

Premium.

Preferência:

gold_pro

O item.service possui fallback:

gold_pro

Porém a disponibilidade do listing type deve ser validada
para a categoria/conta antes da publicação definitiva.

Não assumir que gold_pro é aceito em absolutamente toda
categoria.


============================================================
26. GTIN
============================================================

O TratoCore possui tratamento para:

EMPTY_GTIN_REASON

Foi encontrado no código tratamento específico com:

17055159

IMPORTANTE:

Não transformar esse valor em regra universal.

O motivo de ausência de GTIN depende da situação/categoria.

Regra:

Se houver GTIN real:
→ usar GTIN real.

Se não houver:
→ verificar o que a categoria permite.

Nunca inventar GTIN.


============================================================
27. ATRIBUTOS
============================================================

O sistema atual NÃO possui ainda um motor universal de
atributos por categoria.

Existe regra específica para:

MLB191838
Pratos

Isso não deve ser confundido com um sistema geral.

Objetivo futuro:

categoria
 ↓
atributos obrigatórios
 ↓
atributos condicionais
 ↓
atributos opcionais
 ↓
montagem do payload


============================================================
28. CATEGORIA — REGRA
============================================================

Não adivinhar categoria.

Não inventar category_id.

Não colocar categoria fixa para todos os produtos.

A categoria deve ser obtida/validada pelo Mercado Livre.

Somente depois:

category_id
 ↓
atributos
 ↓
payload
 ↓
publicação


============================================================
29. PRODUTO DE TESTE
============================================================

Produto escolhido anteriormente:

Produto #13

Conjunto de Pratos Fundos Duralex Âmbar Vintage

Quantidade:

4 pratos

Preço:

R$ 120,00

Condição:

USADO

Categoria identificada anteriormente:

MLB191838

Categoria:

Pratos

Esse produto pode ser utilizado como primeiro candidato
para a publicação real, desde que o payload seja validado.


============================================================
30. BANCO — DADOS MERCADO LIVRE
============================================================

A tabela products possui campos para publicação:

ml_item_id
ml_permalink
ml_status
ml_category_id
ml_listing_type
published_at
last_sync_at


Após publicação:

ml_item_id
→ ID do anúncio

ml_permalink
→ link do anúncio

ml_status
→ status retornado pelo Mercado Livre

published_at
→ data da publicação

last_sync_at
→ última sincronização


============================================================
31. ML PRODUCT SERVICE
============================================================

Arquivo:

api\services\ml\mlProduct.service.js

Funções:

savePublication()

updateStatus()

getPublication()

Responsabilidade:

salvar e consultar o vínculo entre:

Produto TratoCore
        ↕
Anúncio Mercado Livre


============================================================
32. PUBLISH SERVICE
============================================================

Arquivo:

api\services\ml\publish.service.js

Responsabilidade:

orquestrar a publicação.

Fluxo:

produto
 ↓
imagens
 ↓
token
 ↓
upload das imagens
 ↓
build do item
 ↓
POST /items
 ↓
descrição
 ↓
salvar publicação


============================================================
33. API SERVICE
============================================================

Arquivo:

api\services\ml\api.service.js

Responsabilidade:

comunicação com Mercado Livre.

Já possui operações relacionadas a:

/users/me

/items

/items/{id}/description

/items/{id}

PUT /items/{id}

Também existe tratamento de renovação do token em caso
de 401.


============================================================
34. ML TEMPLATE SERVICE
============================================================

Arquivo:

api\services\mlTemplate.service.js

Existe suporte a template Excel.

Campos tratados incluem:

Título
Preço
Marca
Modelo
SKU
Quantidade
Estoque
Descrição
Condição
Fotos

Esse serviço NÃO é o caminho principal da publicação
atual.

A missão atual utiliza API Oficial.


============================================================
35. ARQUITETURA DO PRIMEIRO ANÚNCIO
============================================================

Produto no TratoCore
        ↓
Fotos
        ↓
product_images
        ↓
Categoria Mercado Livre
        ↓
Atributos obrigatórios
        ↓
GTIN / EMPTY_GTIN_REASON
        ↓
listing_type
        ↓
pictures
        ↓
Payload
        ↓
Validação
        ↓
POST /items
        ↓
MLBxxxxxxxx
        ↓
Permalink
        ↓
Salvar no PostgreSQL


============================================================
36. ESTADO REAL ATUAL
============================================================

COMPONENTE                         ESTADO

PostgreSQL 17                     OK
Express                           OK
Node.js                           OK
Cadastro de produtos              OK
Tabela product_images              OK
FK produto/imagem                 OK
Índices                           OK
Upload backend                    OK
upload.js syntax                  OK
Servidor Node                     OK
index.html                        OK
Seleção múltipla                  OK
Até 10 fotos                      OK
Preview ordenado                  EM TESTE
Salvamento das múltiplas imagens  AINDA NÃO VALIDADO
OpenAI                            401 / API KEY
OAuth ML                          OK
Refresh Token ML                  OK
Access Token ML                   OK
/api/ml/me                        OK
Category Predictor                403
Categoria automática              BLOQUEADA
Atributos universais              AINDA NÃO IMPLEMENTADOS
Publicação real                   AINDA NÃO CONCLUÍDA


============================================================
37. BLOQUEIOS ATUAIS
============================================================

BLOQUEIO 1:

OpenAI API Key.

Resultado:

401 Incorrect API key provided.

Impacto:

IA não pode ser utilizada até corrigir a chave.


BLOQUEIO 2:

Mercado Livre:

domain_discovery

Resultado:

403 Forbidden

Impacto:

Categoria automática ainda não pode ser obtida por esse
endpoint.


============================================================
38. O QUE NÃO É MAIS BLOQUEIO
============================================================

NÃO considerar como bloqueio:

OAuth
PKCE
Refresh Token
Access Token
PostgreSQL
/users/me
Express
Upload
picture.service


Esses componentes já foram validados.


============================================================
39. MISSÃO ATUAL
============================================================

MISSÃO:

ML-003 / CATEGORIA

Objetivo:

Resolver a descoberta/validação da categoria sem criar
arquitetura paralela.

Ordem:

1. Investigar 403 do domain_discovery.
2. Utilizar alternativa oficial se necessário.
3. Obter category_id.
4. Consultar atributos.
5. Montar payload.
6. Validar.
7. Publicar primeiro anúncio.


============================================================
40. PRÓXIMA MISSÃO IMEDIATA
============================================================

ML-004A

Testar a árvore oficial de categorias:

GET

https://api.mercadolivre.com/sites/MLB/categories

Objetivo:

verificar se o acesso à estrutura de categorias funciona
mesmo com o 403 no domain_discovery.

NÃO alterar arquivos antes desse teste.


============================================================
41. REGRAS DE DESENVOLVIMENTO
============================================================

REGRA 1:

Nunca reescrever código funcionando.

REGRA 2:

Nunca criar arquitetura paralela.

REGRA 3:

Nunca trocar tecnologia sem necessidade.

REGRA 4:

Sempre criar backup antes de alterar arquivo importante.

REGRA 5:

Sempre validar sintaxe após alteração.

REGRA 6:

Sempre testar no navegador quando a alteração for frontend.

REGRA 7:

Nunca adivinhar atributos do Mercado Livre.

REGRA 8:

Nunca inventar GTIN.

REGRA 9:

Nunca alterar OAuth se o OAuth estiver funcionando.

REGRA 10:

Resolver primeiro o bloqueio atual.

REGRA 11:

Utilizar documentação oficial do Mercado Livre quando
houver dúvida sobre API.

REGRA 12:

Não iniciar novas funcionalidades antes da primeira
publicação real.


============================================================
42. PROCEDIMENTO PARA ALTERAR CÓDIGO
============================================================

ANTES:

backup

DURANTE:

alterar somente o necessário

DEPOIS:

node --check

ENTÃO:

rodar servidor

ENTÃO:

testar endpoint

ENTÃO:

testar navegador, quando aplicável.


============================================================
43. COMANDOS IMPORTANTES
============================================================

Verificar Node:

"C:\Program Files\nodejs\node.exe" --version


Verificar sintaxe:

"C:\Program Files\nodejs\node.exe" --check
"C:\TratoCore\arquivo.js"


Iniciar servidor:

"C:\Program Files\nodejs\node.exe"
"C:\TratoCore\api\server.js"


PostgreSQL:

"C:\Program Files\PostgreSQL\17\bin\psql.exe"


Verificar tabela:

"C:\Program Files\PostgreSQL\17\bin\psql.exe"
-U postgres
-d tratocore
-P pager=off
-c "\d product_images"


============================================================
44. INCIDENTES DE TERMINAL
============================================================

Em algumas ocasiões:

node

não foi reconhecido pelo PATH.

Foi resolvido utilizando:

C:\Program Files\nodejs\node.exe


Em algumas ocasiões:

psql

não foi reconhecido pelo PATH.

Foi resolvido utilizando:

C:\Program Files\PostgreSQL\17\bin\psql.exe


notepad

também não foi reconhecido diretamente.

Foi localizado:

C:\Windows\System32\notepad.exe


Portanto, quando o PATH falhar, utilizar o caminho completo.


============================================================
45. IMPORTANTE SOBRE POWERSHELL
============================================================

Não colar código JavaScript diretamente no PowerShell.

Exemplo ERRADO:

const ...
let ...
// comentário

O PowerShell tenta interpretar isso como comando.

Para executar JavaScript:

usar node -e

ou

editar o arquivo .js.

Para editar arquivos:

usar:

C:\Windows\System32\notepad.exe
C:\TratoCore\arquivo


============================================================
46. ESTADO DE RETOMADA
============================================================

PONTO EXATO DE RETOMADA:

O TratoCore está com a infraestrutura de publicação
do Mercado Livre praticamente montada.

OAuth e /api/ml/me estão funcionando.

O teste do Category Predictor:

/sites/MLB/domain_discovery/search

retorna:

HTTP 403 Forbidden.

A próxima ação é investigar/contornar esse bloqueio
usando somente mecanismos oficiais.

Não mexer em OAuth.

Não mexer no token.

Não mexer no publish.service.

Não mexer no item.service sem motivo.

Primeiro resolver categoria.


============================================================
47. OBJETIVO FINAL IMEDIATO
============================================================

PRIMEIRO ANÚNCIO REAL.

Produto candidato:

#13
Conjunto de Pratos Fundos Duralex Âmbar Vintage

4 unidades
R$ 120,00
Usado
Categoria anteriormente identificada:
MLB191838 — Pratos


Resultado esperado:

POST /items
        ↓
HTTP 201
        ↓
MLBxxxxxxxx
        ↓
permalink
        ↓
ml_item_id salvo
        ↓
status salvo
        ↓
MVP DE PUBLICAÇÃO CONCLUÍDO


============================================================
48. NÃO CONSIDERAR O MVP CONCLUÍDO AINDA
============================================================

O TratoCore NÃO deve ser considerado MVP finalizado
até ocorrer uma publicação REAL no Mercado Livre.

Só depois de:

POST /items
+
retorno válido
+
MLBxxxxxxxx
+
permalink
+
registro no PostgreSQL

o MVP de publicação será considerado concluído.


============================================================
49. HISTÓRICO RESUMIDO
============================================================

Inicialmente o bloqueio era OAuth/PKCE.

Depois foram corrigidos:

- OAuth
- PKCE
- callback
- token
- refresh token
- PostgreSQL
- picture.service
- upload multipart
- item.service
- publish.service

Depois foi implementada a estrutura de multifoto.

Foi criada/confirmada:

product_images

com:

is_main
sort_order
original_url
thumb_url
file_name
mime_type
width
height
file_size

Também foram realizados backups dos arquivos críticos.

Atualmente o foco voltou para:

MERCADO LIVRE
        ↓
CATEGORIA
        ↓
ATRIBUTOS
        ↓
PRIMEIRO ANÚNCIO


============================================================
50. REGRA DE OURO DO TRATOBOOK
============================================================

NÃO VOLTAR PARA UM PROBLEMA JÁ RESOLVIDO.

Se:

OAuth = OK

não mexer em OAuth.

Se:

PostgreSQL = OK

não recriar banco.

Se:

Upload = OK

não reescrever upload.

Se:

/users/me = OK

não investigar token como primeira hipótese.

Resolver somente o problema atual.

============================================================
FIM DO TRATOBOOK — VERSÃO 3.0
============================================================

PONTO DE RETOMADA:

ML-004A

Testar:

GET
https://api.mercadolibre.com/sites/MLB/categories

Depois:

categoria
→ atributos
→ payload
→ primeira publicação real.
============================================================

============================================================
TRATOBOOK — ATUALIZAÇÃO CRÍTICA
============================================================

Data: 11/08/2026
Versão: 4.0

PONTO EXATO DE RETOMADA — MERCADO LIVRE / CATÁLOGO

O OAuth, token, refresh token, PostgreSQL, /api/ml/me e health
estão funcionando e NÃO devem ser reabertos como hipótese de
problema.

Foram testados os mecanismos oficiais de categorização e catálogo.

1. CATEGORY PREDICTOR

Endpoint:
/sites/MLB/domain_discovery/search

Resultado:
HTTP 403 Forbidden.

Decisão:
Não usar esse endpoint como dependência única do fluxo novo.

2. BUSCA DE ANÚNCIOS

Foi criado em api.service.js:
searchItems(query, categoryId, limit)

Endpoint:
/sites/MLB/search

Teste usando o token real do TratoCore:
HTTP 403 Forbidden.

Decisão:
Não usar a busca de anúncios como núcleo da estratégia de
"Vender um igual".

3. BUSCA DE PRODUTOS / CATÁLOGO

Foi criado em api.service.js:
searchProducts(query, limit)
getProduct(productId)

Endpoints:
/products/search
/products/{PRODUCT_ID}

Resultado:
FUNCIONANDO com o token real.

A busca por texto retorna candidatos, porém pode trazer produtos
errados. Exemplo: buscas por Xbox retornaram Xbox Series X,
Xbox One S, jogos, controles e acessórios.

REGRA:
Nunca aceitar o primeiro resultado automaticamente.

4. PRODUTO DE TESTE PRINCIPAL

Produto #17:
Console Microsoft Xbox Clássico Original Preto Usado

Preço: R$ 850,00
Quantidade: 1
Condição: used
Categoria: MLB11172 — Consoles
Listing type: gold_pro / Premium

O Predictor chegou a sugerir SUBMODEL = S para esse produto.
Essa sugestão foi considerada incorreta e NÃO deve ser aceita
automaticamente.

REGRA:
O Predictor pode sugerir categoria, mas não pode inventar ou
forçar atributos que não estejam comprovados pelo produto.

5. CATALOG MATCHER

Arquivo criado:
C:\TratoCore\api\services\ml\catalogMatcher.service.js

Objetivo:
Comparar o produto identificado pelo TratoCore com candidatos
do catálogo do Mercado Livre.

Primeiro teste realizado com identificação:
product_type = console
brand = Microsoft
line = Xbox
model = Xbox
generation = Xbox Classic
color = Preto

RESULTADO DO PRIMEIRO MATCHER:
Escolheu incorretamente:
MLB47617993 — The Simpsons Road Rage Xbox Clássico
Score: 38

O candidato era um JOGO, não um console.

Conclusão:
O primeiro algoritmo ainda dá peso excessivo a palavras genéricas
como Xbox e Clássico.

6. PRÓXIMA TAREFA — BLOQUEADORA

CORRIGIR catalogMatcher.service.js.

A filtragem de compatibilidade deve ocorrer ANTES do ranking.

Para product_type = console:

- candidato fora do domínio MLB-GAME_CONSOLES → DESCARTAR
- jogo / game / disco / mídia → DESCARTAR
- controle / joystick / gamepad / controller → DESCARTAR
- cabo / adaptador / case / capa / fonte / carregador / acessório → DESCARTAR

Para Xbox Classic:

- Series X → incompatível
- Series S → incompatível
- Xbox One → incompatível
- One S → incompatível
- One X → incompatível

Somente depois da filtragem calcular o score.

7. REGRA DE MATCH SEGURO

Não publicar automaticamente apenas porque existe um candidato.

Match seguro exige:
- score alvo >= 90
- nenhuma incompatibilidade crítica
- domínio correto
- produto/modelo/linha compatíveis

Se não houver match seguro:
seguir o fluxo normal do TratoCore.

Fluxo normal:
produto → categoria → atributos → conditional attributes
→ montagem do payload → /items/validate → publicação

8. ARQUITETURA APROVADA PARA "VENDER UM IGUAL"

A ideia do fluxo manual foi considerada boa, mas não será
implementada por automação de navegador.

Fluxo desejado:

FOTO
 ↓
IA identifica produto
 ↓
extrai fatos confiáveis
 ↓
busca produto no catálogo ML
 ↓
filtra candidatos incompatíveis
 ↓
ranqueia candidatos
 ↓
match seguro?
 ├─ SIM → usar ficha/referência do catálogo
 └─ NÃO → fluxo normal de categorização/publicação
 ↓
adaptar para dados reais do produto
 ↓
nossas fotos + nosso preço + nossa condição
 ↓
/items/validate
 ↓
publicação

9. NÃO ALTERAR AGORA

Não alterar publish.service.js.
Não alterar item.service.js sem necessidade.
Não alterar publicationSpec.service.js.
Não alterar OAuth.
Não alterar token.service.js.
Não conectar publicação automática ao matcher ainda.

Primeiro provar o matcher com o Xbox Classic.

10. BACKUPS

Pasta principal:
C:\TratoCore\backup\ml-arquitetura-2026-08-11

Existem backups da arquitetura principal e backups adicionais
realizados antes das alterações de busca e matcher.

11. DESCRIÇÃO

Foi observado durante o uso manual do Mercado Livre que o botão
"Criar descrição" produz atualmente uma descrição melhor que a
descrição gerada pelo TratoCore.

Isso fica registrado como melhoria futura.
Não faz parte da correção atual do catalogMatcher.

12. REGRA DE RETOMADA

AO RETOMAR O PROJETO:

1. Não voltar para OAuth.
2. Não voltar para token.
3. Não voltar para /users/me.
4. Não voltar para searchItems como solução principal.
5. Abrir catalogMatcher.service.js.
6. Implementar descarte de candidatos incompatíveis ANTES do ranking.
7. Repetir o teste do Xbox Classic.
8. Só depois considerar integração com o fluxo de publicação.

PONTO EXATO:

catalogMatcher.service.js
        ↓
FILTRAGEM DE COMPATIBILIDADE
        ↓
RANKING
        ↓
TESTE XBOX CLASSIC
        ↓
MATCH SEGURO
        ↓
SOMENTE ENTÃO PUBLICAÇÃO

============================================================
FIM DA ATUALIZAÇÃO 11/08/2026
============================================================

============================================================
TRATOBOOK — ATUALIZAÇÃO DE RETOMADA
============================================================

Data: 12/08/2026
Versão: 5.0

PONTO EXATO DE RETOMADA — SERVIDOR / MERCADO LIVRE

O TratoCore foi novamente validado após correções no
api.service.js e está iniciando normalmente.

ESTADO CONFIRMADO NESTA SESSÃO:

- node --check api.service.js → OK
- node --check oauth.service.js → OK
- node --check token.service.js → OK
- node --check picture.service.js → OK
- node --check item.service.js → OK
- node --check publish.service.js → OK
- node --check mlController.js → OK
- node --check routes/ml.js → OK
- Servidor Node → iniciou sem MODULE_NOT_FOUND/SyntaxError
- PostgreSQL → conectado
- OpenAI → chave carregada
- Servidor → http://localhost:3000
- API → http://localhost:3000/api
- Produtos → /api/products
- Upload → /api/upload
- Imagens → /api/product-images
- IA → /api/ai/analyze

CORREÇÕES RECENTES:

Durante a sessão houve corrupção acidental do conteúdo do
api.service.js com caracteres literais `n e referências Markdown.
O arquivo REAL foi corrigido e voltou a passar no node --check.

Também ocorreu tentativa de alterar uma cópia de backup em vez
do arquivo real. A partir deste ponto:

ARQUIVO REAL:
C:\TratoCore\api\services\ml\api.service.js

NÃO CONFUNDIR COM BACKUP.

Foi necessário criar/confirmar a pasta de backup antes de copiar
o arquivo funcional. Não alterar backup como se fosse arquivo ativo.

REGRA OPERACIONAL REFORÇADA:

1. Sempre confirmar o caminho do arquivo REAL antes de editar.
2. Fazer backup ANTES da alteração.
3. Alterar o arquivo REAL.
4. Executar node --check.
5. Iniciar o servidor.
6. Testar a função afetada.
7. Só então atualizar o backup, se necessário.

NÃO VOLTAR PARA PROBLEMAS JÁ RESOLVIDOS:

OAuth → OK.
PKCE → OK.
Token → OK.
Refresh token → OK.
PostgreSQL → OK.
/users/me → OK.
Servidor → OK.
Upload/multifoto → já validado no histórico.

MERCADO LIVRE — BLOQUEIO/FOCO ATUAL:

O Category Predictor:
/sites/MLB/domain_discovery/search
continua registrado como HTTP 403 Forbidden.

A busca de anúncios /sites/MLB/search também foi registrada como
HTTP 403 e não deve ser usada como núcleo do matcher.

A busca de produtos de catálogo:
/products/search
/products/{PRODUCT_ID}
foi validada como funcionando com o token real.

CATALOG MATCHER:

Arquivo:
C:\TratoCore\api\services\ml\catalogMatcher.service.js

PONTO EXATO DO DESENVOLVIMENTO:

catalogMatcher.service.js
        ↓
FILTRAGEM DE COMPATIBILIDADE
        ↓
RANKING
        ↓
TESTE XBOX CLASSIC
        ↓
MATCH SEGURO
        ↓
SOMENTE ENTÃO PUBLICAÇÃO

O primeiro teste do Xbox Classic escolheu incorretamente um jogo
(The Simpsons Road Rage Xbox Clássico), score 38.

Portanto, a próxima alteração deve ser exclusivamente a filtragem
pré-ranking de candidatos incompatíveis.

Para console:
- jogos/games/discos/mídia → descartar
- controles/joysticks/gamepads/controllers → descartar
- cabos/adaptadores/cases/capas/fontes/carregadores/acessórios → descartar
- candidatos fora do domínio correto → descartar

Para Xbox Classic:
- Series X → incompatível
- Series S → incompatível
- Xbox One → incompatível
- One S → incompatível
- One X → incompatível

Somente depois calcular score.

MATCH SEGURO:
- score alvo >= 90
- nenhuma incompatibilidade crítica
- domínio correto
- produto/modelo/linha compatíveis

Se não houver match seguro, seguir o fluxo normal:
produto → categoria → atributos → conditional attributes
→ /items/validate → publicação.

PRIMEIRO ANÚNCIO REAL:

O MVP só será considerado concluído depois de uma publicação real
com retorno válido da API, MLBxxxxxxxx, permalink e registro no
PostgreSQL.

Produto candidato histórico:
#13 — Conjunto de Pratos Fundos Duralex Âmbar Vintage
4 unidades — R$ 120,00 — usado
Categoria MLB191838 — Pratos.

PRODUTO PRINCIPAL PARA VALIDAR O MATCHER:

#17 — Console Microsoft Xbox Clássico Original Preto Usado
R$ 850,00 — quantidade 1 — used
Categoria MLB11172 — Consoles
Listing type: gold_pro / Premium.

ARQUITETURA APROVADA “VENDER UM IGUAL”:

FOTO
 ↓
IA identifica produto
 ↓
extrai fatos confiáveis
 ↓
busca produto no catálogo ML
 ↓
filtra incompatíveis
 ↓
ranqueia
 ↓
match seguro?
  SIM → usar ficha/referência do catálogo
  NÃO → fluxo normal
 ↓
adaptar para produto real
 ↓
nossas fotos + nosso preço + nossa condição
 ↓
/items/validate
 ↓
publicação

NÃO ALTERAR AGORA:
- OAuth
- token.service.js
- publish.service.js
- item.service.js sem necessidade
- publicationSpec.service.js
- integração automática do matcher com publicação

PRÓXIMA AÇÃO EXATA:

1. Abrir catalogMatcher.service.js.
2. Fazer backup.
3. Implementar descarte de candidatos incompatíveis ANTES do ranking.
4. node --check.
5. Rodar o servidor.
6. Repetir o teste do Xbox Classic.
7. Confirmar se o jogo é descartado.
8. Confirmar se o console correto sobe para o topo.
9. Só depois tratar match seguro e integração com publicação.

REGRA DE OURO:

NÃO REMENDAR COMANDOS QUANDO FOR MAIS SEGURO SUBSTITUIR O
ARQUIVO/ALTERAÇÃO COMPLETA.

Quando uma alteração de arquivo for necessária, fornecer o conteúdo
completo do arquivo para colagem quando isso reduzir risco de erro.

============================================================
FIM DA ATUALIZAÇÃO — 12/08/2026
============================================================

============================================================
TRATOBOOK — ATUALIZAÇÃO DE ESTADO CONSOLIDADO
============================================================

Data: 12/08/2026
Versão: 5.1

PONTO EXATO DE RETOMADA — IA + CATALOG MATCHER + PUBLICAÇÃO

RESUMO EXECUTIVO

O TratoCore está operacional e várias etapas críticas já foram
comprovadas. O problema atual não é mais OAuth, token, PostgreSQL,
servidor, upload ou a publicação básica.

O foco atual é tornar a identificação/categorização inteligente
segura e depois conectar essa inteligência ao fluxo oficial de
publicação.

============================================================
1. O QUE ESTÁ PRONTO E COMPROVADO
============================================================

INFRAESTRUTURA

- Servidor Node/Express funcionando.
- PostgreSQL 17 conectado.
- Banco tratocore funcionando.
- OPENAI_API_KEY carregada pelo servidor.
- Estrutura de produtos funcionando.
- Upload funcionando.
- Estrutura de multifoto/product_images existente e validada.
- Storage local funcionando.

ROTAS CONFIRMADAS:

http://localhost:3000
http://localhost:3000/api
http://localhost:3000/api/products
http://localhost:3000/api/upload
http://localhost:3000/api/product-images
http://localhost:3000/api/ai/analyze

MERCADO LIVRE

- OAuth: OK.
- PKCE: OK.
- callback: OK.
- access token: OK.
- refresh token: OK.
- PostgreSQL para tokens: OK.
- /api/ml/me: OK.
- Conta Mercado Livre autenticada: confirmada.
- Não reabrir OAuth/token como hipótese de problema.

PUBLICAÇÃO

- publish.service.js existente e funcional no fluxo oficial.
- item.service.js existente.
- publicationSpec.service.js existente.
- listing type padrão do TratoCore: gold_pro / Premium.
- O fluxo de publicação básica já foi comprovado com anúncio real.
- Os pratos já foram publicados e NÃO são mais bloqueio.

============================================================
2. IA — ESTADO ATUAL
============================================================

Arquivo:
C:\TratoCore\api\services\ai.service.js

O endpoint /api/ai/analyze foi testado com a imagem real do produto
#17 e retornou JSON válido.

Produto analisado:
Console Microsoft Xbox Clássico Original Preto Usado

A IA identificou:

product_type: Console de videogame
brand: Microsoft
line: Xbox
model: Xbox Classic
generation: Primeira geração
color: Preto com detalhe verde
condition: Usado, com sinais visíveis de uso
confidence: 0.97

A análise funcionou corretamente.

IMPORTANTE:
A IA fornece fatos para o sistema, mas sua sugestão de categoria não
deve ser aceita cegamente. A categoria deve passar pela lógica de
compatibilidade/catalog matcher e/ou pelo fluxo oficial de categoria.

============================================================
3. CATÁLOGO MERCADO LIVRE
============================================================

Em api.service.js estão funcionando:

searchProducts()
getProduct()

Endpoints usados:
/products/search
/products/{PRODUCT_ID}

A busca de catálogo funciona com o token real.

REGRA:
Nunca aceitar automaticamente o primeiro resultado da busca.
A busca pode retornar produtos diferentes, como:
- consoles de outras gerações;
- jogos;
- controles;
- acessórios.

O catalogMatcher existe justamente para impedir esse erro.

============================================================
4. CATALOG MATCHER — ESTADO ATUAL
============================================================

Arquivo REAL:
C:\TratoCore\api\services\ml\catalogMatcher.service.js

O matcher foi corrigido para executar filtragem de incompatibilidade
ANTES do ranking.

A lógica atual considera, entre outros:

CONSOLE:
- domínio correto de consoles;
- jogos/games/mídia como incompatíveis;
- controles/joysticks/gamepads/controllers como incompatíveis;
- cabos/adaptadores/cases/capas/fontes/carregadores como incompatíveis.

XBOX CLASSIC:
- Series X incompatível;
- Series S incompatível;
- Xbox One incompatível;
- One S incompatível;
- One X incompatível.

Depois da filtragem ocorre o ranking por:
- domínio;
- marca;
- linha;
- modelo;
- geração;
- cor;
- termos identificadores.

MATCH SEGURO:
- score alvo >= 90;
- nenhuma incompatibilidade crítica;
- domínio correto;
- produto/modelo/linha compatíveis.

============================================================
5. TESTE REALIZADO DO MATCHER — XBOX CLASSIC
============================================================

Teste controlado executado via Node.

Identificação usada:
- product_type: console
- brand: Microsoft
- line: Xbox
- model: Xbox
- generation: Classic

Candidatos simulados:

1. Xbox Series S 512GB
2. Xbox Classic 1ª Geração

RESULTADO:

- candidates_received: 2
- candidates_removed_as_incompatible: 1
- melhor candidato: CLASSIC
- score: 128
- confidence: HIGH

O Xbox Series S foi eliminado como incompatível.
O Xbox Classic subiu para o primeiro lugar.

Isso comprova que a correção do matcher está funcionando no teste
controlado.

BACKUP CRIADO ANTES DA ALTERAÇÃO:

C:\TratoCore\api\services\ml\catalogMatcher.service.js.antes-primeira-geracao

============================================================
6. PRODUTO PRINCIPAL DE TESTE
============================================================

Produto #17:

Console Microsoft Xbox Clássico Original Preto Usado

Preço: R$ 850,00
Quantidade: 1
Condição: used
Marca: Microsoft
Modelo: Xbox Classic
Cor: Preto
Categoria atualmente salva: MLB11172 — Consoles
Listing type: gold_pro

Imagem usada no teste da IA:
/storage/originals/dbbeb231-3dab-4156-b6fd-7913ef7bcf16.jpeg

A IA analisou essa imagem com confidence 0.97.

============================================================
7. O QUE AINDA FALTA
============================================================

PRIORIDADE 1 — TESTE DO MATCHER COM CANDIDATAS REAIS

Ainda precisamos executar a busca real de produtos do catálogo para o
Xbox Classic e passar os candidatos reais pelo matcher.

Objetivo:
confirmar que jogos, controles, Series S/X, Xbox One e acessórios
sejam eliminados antes do ranking e que um produto realmente
compatível seja escolhido quando existir.

PRIORIDADE 2 — DEFINIR MATCH SEGURO NO FLUXO REAL

O teste controlado já passou.
Ainda falta transformar o resultado em uma decisão operacional:

MATCH HIGH/SEGURO
→ usar referência/ficha do catálogo.

SEM MATCH SEGURO
→ voltar ao fluxo normal de categoria/atributos.

Não publicar automaticamente apenas porque existe um candidato.

PRIORIDADE 3 — INTEGRAÇÃO COM PUBLICAÇÃO

Somente depois de validar o matcher com candidatos reais:

FOTO
↓
IA
↓
IDENTIDADE DO PRODUTO
↓
BUSCA CATÁLOGO
↓
FILTRAGEM
↓
RANKING
↓
MATCH SEGURO?
↓
SIM → referência do catálogo
NÃO → fluxo normal
↓
adaptar dados reais
↓
/items/validate
↓
POST /items
↓
publicação

A integração automática do matcher com publish.service.js ainda NÃO
foi feita e não deve ser feita antes da validação final.

PRIORIDADE 4 — TESTE COM SEGUNDO PRODUTO

Depois do Xbox Classic, testar outro produto para garantir que a lógica
é geral e não um remendo específico para Xbox.

============================================================
8. O QUE NÃO DEVE SER MEXIDO AGORA
============================================================

NÃO mexer em:

- OAuth.
- token.service.js.
- refresh token.
- /users/me.
- PostgreSQL.
- upload/multifoto já validado.
- publish.service.js sem necessidade.
- item.service.js sem necessidade.
- publicationSpec.service.js sem necessidade.

NÃO voltar aos pratos como problema.
Os pratos já foram publicados.

NÃO usar searchItems como núcleo do matcher.

NÃO aceitar o primeiro produto retornado pelo catálogo.

============================================================
9. PRÓXIMA MISSÃO EXATA
============================================================

ML-006 — VALIDAÇÃO REAL DO CATALOG MATCHER

1. Buscar candidatos reais no catálogo para o Xbox Classic.
2. Registrar os candidatos retornados.
3. Passar todos pelo catalogMatcher.
4. Confirmar os descartes de incompatíveis.
5. Confirmar o ranking.
6. Confirmar se existe match seguro.
7. Se necessário, ajustar somente a lógica geral do matcher.
8. Fazer novo backup antes de qualquer alteração.
9. node --check.
10. Testar novamente.
11. Testar um segundo produto.
12. Somente então integrar ao fluxo de publicação.

============================================================
10. REGRA OPERACIONAL REFORÇADA
============================================================

SEMPRE:

backup
→ alterar arquivo REAL
→ node --check
→ iniciar servidor
→ testar função
→ só então avançar.

Quando houver alteração de arquivo, preferir fornecer o ARQUIVO
COMPLETO para colagem, reduzindo risco de corrupção ou alteração
parcial.

============================================================
11. STATUS GERAL
============================================================

INFRAESTRUTURA:              PRONTA
POSTGRESQL:                  PRONTO
UPLOAD:                      PRONTO
MULTIFOTO:                   VALIDADO
OPENAI/IA:                   FUNCIONANDO
OAUTH ML:                    FUNCIONANDO
TOKEN/REFRESH:               FUNCIONANDO
USERS/ME:                    FUNCIONANDO
PUBLICAÇÃO BÁSICA:           COMPROVADA
PRATOS:                      PUBLICADOS
BUSCA CATÁLOGO:              FUNCIONANDO
CATALOG MATCHER:             CORREÇÃO VALIDADA EM TESTE CONTROLADO
MATCHER COM DADOS REAIS:     PENDENTE
INTEGRAÇÃO MATCHER→PUBLISH:  PENDENTE
SEGUNDO TESTE DE PRODUTO:    PENDENTE
MVP INTELIGENTE FINAL:       PENDENTE

============================================================
PONTO EXATO PARA A PRÓXIMA SESSÃO
============================================================

Não voltar para OAuth.
Não voltar para token.
Não voltar para os pratos.
Não voltar para upload.

COMEÇAR EM:

C:\TratoCore\api\services\ml\catalogMatcher.service.js

PRÓXIMO PASSO:
BUSCA REAL DE CANDIDATOS → MATCHER → TESTE XBOX CLASSIC.

============================================================
FIM DA ATUALIZAÇÃO — 12/08/2026 — VERSÃO 5.1
============================================================
