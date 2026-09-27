# TratoCore - acesso por celular e qualquer PC

## 1. No PC servidor
Execute `ABRIR_FIREWALL_PORTA_3000.bat` como Administrador uma unica vez.
Depois execute `INICIAR_TRATOCORE_REDE.bat`.

O console mostrara algo como:
`Rede local: http://192.168.1.50:3000`

## 2. No celular ou outro PC
Conecte ao mesmo Wi-Fi e abra o endereco mostrado no console.

## Testes
- `http://IP_DO_PC:3000/`
- `http://IP_DO_PC:3000/api/health`
- `http://IP_DO_PC:3000/api/tratocap/status`

## API preparada para o TratoCap
`POST /api/tratocap/upload`

multipart/form-data:
- `image`: arquivo da foto
- `album`: nome do album
- `note`: observacao opcional

As fotos ficam centralizadas em `storage/tratocap/albums` e sao acessiveis por `/storage/...`.

## Importante
Este pacote prepara acesso na REDE LOCAL. Para acesso pela internet publica, a proxima etapa deve usar um tunel seguro/autohospedado e autenticacao; nao exponha a porta 3000 diretamente no roteador.
