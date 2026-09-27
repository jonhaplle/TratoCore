# TratoCore + Gemini Interactions API

O fluxo de IA do TratoCore usa a Gemini Interactions API para análise multimodal (foto + texto) e geração do anúncio. A documentação oficial do Google recomenda a Interactions API para novos projetos e mantém `generateContent` como interface legada. Modelos Gemini 3.5 Flash-Lite e 3.1 Flash-Lite são listados como compatíveis com Interactions.

## Configuração

No arquivo `C:\TratoCore\.env`:

```env
GEMINI_API_KEY=SUA_CHAVE
GEMINI_MODEL=gemini-3.5-flash-lite
```

A chave nunca é colocada no pacote.

## Teste

Execute:

```bat
C:\TratoCore\TESTAR_GEMINI_INTERACTIONS.bat
```

O teste não exibe a chave.

## Fluxo

`Foto -> Browser/Lens (quando aplicável) -> Gemini Interactions -> JSON -> Catalog Matcher -> Gemini -> anúncio -> API do Mercado Livre`

O módulo usa `store:false` por padrão para não armazenar a interação no servidor da API.
