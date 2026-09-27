# TratoCore — Release Operacional

Esta release consolida o fluxo local do TratoCore com três pilares:

1. **Gemini** — análise visual, identificação e geração de anúncio por API multimodal.
2. **Mercado Livre** — publicação pelo endpoint oficial da conta conectada.
3. **Browser Engine** — navegador controlado para leitura/interação quando uma API não for suficiente.

## Prioridade de engenharia

- Não sobrescrever `.env` durante atualização.
- Não incluir segredos no ZIP.
- Fazer backup antes de alterar a instalação.
- Validar sintaxe antes de iniciar o servidor.
- Preservar PostgreSQL, storage e dados existentes.
- Usar IA para identificar fatos; nunca inventar marca/modelo.
- Para produto sem marca, usar valor genérico somente quando a categoria do Mercado Livre permitir explicitamente.

## Instalação

Execute como Administrador:

`INSTALAR_ATUALIZAR_TRATOCORE.bat`

## Diagnóstico

`VERIFICAR_TRATOCORE.bat`

## Inicialização

`ABRIR_TRATOCORE.bat`

## Configuração

A release não contém sua chave Gemini nem credenciais do Mercado Livre. Elas permanecem em `C:\TratoCore\.env`.
