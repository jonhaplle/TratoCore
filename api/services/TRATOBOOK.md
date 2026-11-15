# TRATOBOOK — TratoCore
## Versão 6.0 — Entrevista inteligente para geração de anúncios
Atualizado em 15/11/2026

## 1. Missão principal

O TratoCore deve preparar anúncios automaticamente para o Mercado Livre a partir de fotos, dados já cadastrados e observações do vendedor. A entrevista é a etapa que fecha as lacunas de informação e produz o JSON estruturado do anúncio.

**A imagem não é a ficha técnica do produto.** Ela ajuda a identificar o que está visível; não prova características internas, estado funcional, procedência ou dados logísticos.

O fluxo correto é:

1. Selecionar produto e fotos.
2. Extrair evidências visuais e ler a observação do vendedor.
3. Identificar o produto e resolver a categoria folha pelo preditor/API do Mercado Livre.
4. Consultar os atributos oficiais e os atributos condicionais atuais da categoria.
5. Cruzar os requisitos com dados existentes, evidências, catálogo e respostas já confirmadas.
6. Entrevistar o vendedor somente sobre campos ausentes, ambíguos ou hipóteses de baixa confiança.
7. Montar JSON final com valores, origem, confiança, confirmação e pendências.
8. Validar o JSON contra a ficha atual do Mercado Livre e os requisitos logísticos.
9. Mostrar a revisão completa e exigir aprovação humana explícita.
10. Publicar somente após ação deliberada do vendedor.

A entrevista deve ser conversacional, objetiva e contextual. Não perguntar novamente o que já está comprovado. Não transformar hipótese em fato.

## 2. Fontes de informação e precedência

Cada campo deve manter sua origem:

- `seller_confirmed`: resposta explícita do vendedor na entrevista/revisão.
- `seller_observation`: declaração escrita pelo vendedor.
- `existing_product`: dados do cadastro do produto.
- `image_evidence`: característica efetivamente visível nas fotos.
- `ml_catalog`: informação de catálogo técnico, que pode exigir confirmação.
- `catalog_hypothesis`: padrão provável de linha/modelo; nunca é confirmação.
- `package_suggestion`: medida de embalagem sugerida; nunca é medida real confirmada.
- `unknown`: não há evidência suficiente.

A declaração explícita do vendedor não pode ser substituída por palpite da visão. Se fontes entrarem em conflito, mostrar o conflito e pedir confirmação.

## 3. O que a imagem pode e não pode afirmar

### Pode ajudar a identificar
- tipo de produto e características externas visíveis;
- marca/modelo quando legíveis e inequívocos;
- cor aparente, acabamento, conexões e componentes visíveis;
- defeitos externos que apareçam claramente na foto.

### Não pode confirmar sozinha
- memória RAM, armazenamento interno, processador e variantes internas;
- número de homologação Anatel, IMEI, serial, GTIN ou códigos não legíveis;
- funcionamento, bateria, testes, bloqueios e histórico de reparo;
- acessórios que não estejam claramente nas fotos;
- dimensões/peso da embalagem;
- autoria, autenticidade, técnica, época, procedência ou valor histórico de quadros/antiguidades;
- qualquer característica oculta ou que dependa de teste, medição ou documento.

Exemplos:
- Celular: perguntar capacidade/RAM, variante, Anatel, operadora e funcionamento quando não houver evidência confiável.
- Quadro: perguntar autor, técnica, medidas, época e procedência; não atribuir autoria pela aparência.
- Videogame: perguntar versão, armazenamento, funcionamento, controles/cabos e acessórios não visíveis.

## 4. Regras da entrevista

- Uma pergunta por vez sempre que possível; agrupar apenas campos simples e relacionados.
- Perguntar apenas campos obrigatórios/condicionais do Mercado Livre que ainda não estejam resolvidos e dados de negócio essenciais.
- Hipóteses do catálogo e sugestões de embalagem devem ser confirmadas explicitamente.
- Para listas oficiais, oferecer as opções devolvidas pelo Mercado Livre.
- Para campos numéricos/unidade, respeitar `value_type`, `allowed_units` e `default_unit` da definição oficial.
- Para campo desconhecido, permitir que o vendedor diga que não sabe. Se obrigatório, bloquear a publicação e explicar o motivo.
- Campo opcional desconhecido deve permanecer omitido/null; nunca completar por conveniência.
- Não inventar marca, modelo, versão, capacidade, GTIN, Anatel, número de série ou dimensões.
- A resposta do vendedor deve ser enviada de volta ao serviço para recalcular requisitos e JSON; não basta alterar visualmente a tela.

## 5. JSON da entrevista

A revisão deve devolver um objeto `interview` versionado, contendo:

- `version`: versão do contrato de entrevista;
- `category_id`: categoria folha selecionada;
- `fields[]`: `id`, `name`, `value_id`, `value_name`, `value_struct`, `source`, `confidence`, `confirmed`;
- `unresolved[]`: atributos obrigatórios ainda sem valor e motivo;
- `awaiting_confirmation[]`: hipóteses/sugestões que aguardam confirmação;
- `validation.ready`: resultado da validação;
- `validation.blocked_by[]`: motivos que impedem a publicação.

O JSON final de publicação deve usar os IDs e formatos aceitos pela categoria atual. Não enviar rótulos arbitrários quando o Mercado Livre exige `value_id` ou `value_struct`.

## 6. Validação e publicação

- Categoria deve ser folha; não fixar `category_id` por tipo de produto.
- Consultar atributos da categoria e atributos condicionais em tempo real.
- Não preencher automaticamente atributos `hidden`, `read_only` ou `fixed`, exceto regras logísticas explícitas e validadas.
- Respeitar condição novo/usado e dependências condicionais.
- Validar dimensões/peso da embalagem conforme modalidade logística e retorno atual do Mercado Livre. Dimensões/peso de embalagem não são inferidos de fotos nem preenchidos com medidas padrão; o vendedor informa os valores reais.
- Não habilitar publicação enquanto houver atributo obrigatório pendente, hipótese aguardando confirmação, erro de categoria, preço inválido ou ausência de fotos.
- Revalidar no servidor imediatamente antes de publicar.
- A aprovação explícita do vendedor continua obrigatória. A entrevista nunca publica sozinha.
- Em falha de validação do Mercado Livre, devolver os campos faltantes à entrevista sem publicar.

## 7. Implementação desta entrega — 15/11/2026

Branch: `feature/entrevista-inteligente-json-anuncio`

Arquivos alterados:
- `api/services/seller/sellerListing.service.js`
  - converte hipóteses de atributos em perguntas explícitas de confirmação;
  - exige as quatro medidas reais de embalagem, sem pré-preencher estimativas genéricas;
  - bloqueia a prontidão enquanto houver hipóteses sem confirmação ou medidas logísticas obrigatórias ausentes;
  - inclui o objeto estruturado `interview` na resposta da revisão.
- `public/anuncio.js`
  - não envia hipóteses como se já fossem respostas do vendedor;
  - mostra a sugestão e permite confirmar/corrigir;
  - ao confirmar, envia o valor para nova revisão no servidor.
- `api/services/seller/sellerListing.service.test.js`
  - cobre perguntas de confirmação e a remoção da pendência após confirmação explícita.

Importante: esta entrega corrige a confirmação silenciosa de hipóteses no fluxo da tela de anúncio. Não significa que toda a entrevista esteja concluída para todos os tipos de produto. A cobertura de todos os atributos, respostas livres, fluxo de “não sei”, voz e testes de ponta a ponta ainda precisa ser validada.

## 8. Estado conhecido e próximos passos

### Já existente no código-base (antes desta entrega)
- Tela única de revisão em `public/anuncio.html` / `public/anuncio.js`.
- Endpoint `POST /api/vendedor/anuncio/revisao`.
- Orquestração em `api/services/seller/sellerListing.service.js`.
- Identificação por imagem/observação em `identificationVendedor.service.js`.
- Consulta da categoria/atributos/atributos condicionais em `publicationSpec.service.js`.
- Requisitos e hipóteses em `attributeRequirementsVendedor.service.js`.
- Publicação separada, condicionada à aprovação, em `publishVendedor.service.js`.

### Próximos passos obrigatórios
1. Executar os testes de `sellerListing.service.test.js`, `attributeRequirementsVendedor.service.test.js` e `packageRequirement.test.js`.
2. Corrigir regressões apontadas pelos testes antes de integrar.
3. Testar ponta a ponta com um celular e um quadro/antiguidade, verificando que os campos impossíveis de inferir são perguntados.
4. Testar valores de lista, texto livre, número, número/unidade e resposta “não sei”.
5. Confirmar que o JSON final corresponde ao payload aceito pelo endpoint de validação do Mercado Livre.
6. Somente depois avaliar integração de voz na mesma entrevista. Voz é interface opcional; não é o motor de regras.
7. Abrir PR e aguardar revisão. Não fazer merge/deploy/publicação real sem autorização.

## 9. Voz

A voz clonada é apenas uma interface de entrada/saída para a entrevista. A lógica de coleta, proveniência, validação e geração do JSON deve funcionar também por texto e sem motor de voz.

O Qwen local em loopback não é automaticamente acessível pelo Render remoto. Não declarar voz clonada remota disponível sem arquitetura e teste específicos. Manter entrada digitada como alternativa.

## 10. Regras permanentes de desenvolvimento

- Não reescrever código funcional sem necessidade comprovada.
- Alterações pequenas, isoladas e testadas.
- Não alterar OAuth, tokens, credenciais ou motor de publicação sem necessidade específica.
- Não publicar anúncios reais durante testes.
- Não apagar fotos, registros ou dados existentes.
- Não criar serviço duplicado quando já houver serviço responsável.
- Não afirmar que algo está integrado, testado ou implantado sem evidência.
- Preservar compatibilidade do TratoCap e das telas existentes.
- Manter segredos fora do Git e nunca exibi-los.

## 11. Nota histórica — versão 5.0

A versão anterior registrava como ponto de retomada o `catalogMatcher.service.js`, filtragem/ranking e teste Xbox Classic. Esse apontamento é um registro histórico da sessão anterior, não substitui a missão principal documentada nesta versão: entrevista inteligente, JSON completo e anúncio automático validado.
