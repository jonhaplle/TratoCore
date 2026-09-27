# TratoCore — acesso de qualquer lugar

Esta versão foi preparada para funcionar como **servidor central**.

## O que foi alterado

- Node/Express escuta em `0.0.0.0`.
- Compatível com túnel HTTPS/reverse proxy.
- `PUBLIC_URL` configurável.
- PWA básico para instalação no celular.
- Fotos continuam centralizadas em `storage/products`.

## Teste remoto grátis imediato

1. No PC servidor, execute `INICIAR_TRATOCORE_REMOTO.bat`.
2. Instale o `cloudflared` uma única vez.
3. Em outro terminal execute `ABRIR_TUNEL_CLOUDFLARE_TEMPORARIO.bat`.
4. Copie o endereço `https://...trycloudflare.com`.
5. Abra esse endereço no celular usando 4G ou em qualquer PC.

**Importante:** o endereço temporário muda quando o túnel é reiniciado.

## Endereço permanente

Para um endereço fixo, configure um Cloudflare Tunnel com hostname próprio e coloque a URL em:

`PUBLIC_URL=https://seu-endereco`

## Fotos

As fotos ficam no PC servidor em `storage/products`. Todos os dispositivos acessam as mesmas fotos através da API/URLs `/storage/...`.

## Próxima etapa

Integrar o TratoCap para enviar diretamente para a URL pública do TratoCore, sem depender de IP local.
