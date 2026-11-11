# Trato Vendedor IA

## Objetivo
Terminal web de atendimento ao cliente, disponível na rede local e remotamente pela mesma aplicação TratoCore.

## Implantação
- Local: iniciar o TratoCore no notebook e abrir `http://localhost:3000/vendedor.html` ou o endereço LAN do notebook.
- Remoto: abrir `https://SEU-DOMINIO/vendedor.html`.
- A interface usa URLs relativas e a mesma API da origem; não requer CORS adicional nem segundo servidor web.

## Catálogo e atendimento
- Pesquisa lexical no PostgreSQL com normalização de acentos e pontuação.
- Exibe somente produtos ACTIVE, com quantidade e preço válidos.
- Mostra foto, título, condição e preço.
- Entrada por voz pelo Web Speech Recognition, quando suportado pelo navegador.
- Encaminhamento de dúvidas para uma caixa no PostgreSQL.
- Caixa da equipe protegida por `TRATO_VENDEDOR_ADMIN_KEY`.

## Voz clonada local — Qwen3-TTS
A voz clonada usa o modelo `Qwen/Qwen3-TTS-12Hz-0.6B-Base` já testado no computador da loja. A síntese é local, em CPU, sem OpenAI, Gemini ou outro serviço pago.

### Requisitos
- Windows com o ambiente Python criado no teste em `%USERPROFILE%\Downloads\.venv_qwen`.
- Pacotes `qwen-tts` e `soundfile` instalados nesse ambiente.
- Arquivo de referência `marcos_voz_referencia_nova.wav` em Downloads.
- Modelo Qwen3-TTS previamente baixado pelo Hugging Face.

### Como iniciar
1. Inicie o TratoCore normalmente.
2. Abra o terminal de voz em `tools/trato-vendedor-voice`.
3. Execute `INICIAR_VOZ_MARCOS.bat`.
4. Aguarde no terminal a mensagem `Pronto em http://127.0.0.1:8765`.
5. Abra ou atualize `http://localhost:3000/vendedor.html`.
6. O controle **Usar voz clonada do Marcos** será habilitado quando o motor local responder. Ele fica ativado automaticamente quando disponível; pode ser desligado para voltar à voz do navegador.

Se o WAV estiver em outro local, defina a variável `TRATO_VENDEDOR_VOICE_REF` antes de iniciar o BAT, apontando para o arquivo correto.

### Arquitetura e limites
- O processo Python escuta somente em `127.0.0.1:8765`; não fica exposto diretamente à rede.
- O Node/Express encaminha os pedidos de áudio por `/api/vendedor/voice/speak` e devolve WAV ao navegador.
- O modelo é carregado uma vez e permanece na memória enquanto o terminal de voz estiver aberto. A geração é sequencial.
- O áudio gerado é enviado em memória; não é salvo em disco.
- A voz clonada funciona quando o TratoCore e o motor Qwen estão no computador da loja. A instância do Render não consegue acessar o Qwen instalado no notebook; no remoto, a interface mantém a voz padrão do navegador.
- Se o motor local estiver desligado ou falhar, a interface usa automaticamente a voz do navegador.
- A gravação de referência é pessoal e não deve ser enviada ao GitHub. O repositório contém apenas o caminho local configurável e a transcrição de referência.

## Variáveis de ambiente
```env
TRATO_VENDEDOR_ADMIN_KEY=gere-uma-chave-longa-e-exclusiva
TRATO_VENDEDOR_VOICE_REF=C:\Users\SEU_USUARIO\Downloads\marcos_voz_referencia_nova.wav
TRATO_VENDEDOR_TTS_PORT=8765
```

Não reutilize a chave do Google Drive nem credenciais do Mercado Livre.

## Rotas
- `GET /api/vendedor/status`
- `GET /api/vendedor/search?q=termo`
- `POST /api/vendedor/handoff`
- `GET /api/vendedor/handoffs` — exige `Authorization: Bearer <TRATO_VENDEDOR_ADMIN_KEY>`
- `GET /api/vendedor/voice/status`
- `POST /api/vendedor/voice/speak` — recebe `{"text":"..." }` e retorna `audio/wav` quando o Qwen local está ativo.

A tabela `trato_vendedor_handoffs` é criada automaticamente na primeira solicitação de encaminhamento. Nenhuma tabela existente é alterada.

## Limites conhecidos
- A busca é lexical, sem LLM; não interpreta intenção complexa nem responde perguntas sobre características ausentes no cadastro.
- Voz de entrada depende do suporte do navegador e normalmente exige HTTPS ou localhost.
- Fotos servidas por proxy externo podem exigir internet mesmo quando a interface local está disponível.
- A caixa de atendimento lista solicitações novas; atualização de status e painel operacional completo ficam para uma etapa posterior.

## Isolamento
A integração de voz adiciona um serviço local independente e endpoints próprios no módulo Vendedor. Não altera TratoCap, publicação do Mercado Livre, cadastro de produtos, OAuth ou tabelas existentes.
