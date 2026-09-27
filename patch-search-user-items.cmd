@echo off
setlocal
cd /d C:\TratoCore
set "P=api\services\ml\api.service.js"

echo ===== BACKUP =====
copy /Y "%P%" "%P%.antes-search-user-items-20260818" >nul

findstr /c:"exports.searchUserItems" "%P%" >nul
if not errorlevel 1 (
  echo searchUserItems JA EXISTE. Nenhuma alteracao necessaria.
  goto :check
)

echo ===== ADICIONANDO searchUserItems =====
node -e "const fs=require('fs');const p='api/services/ml/api.service.js';const s=fs.readFileSync(p,'utf8');const c='^n^nexports.searchUserItems = async (userId, params = {}) => {^n    if (!userId) throw new Error(\"user_id nao informado para busca de anuncios.\");^n    const token = await exports.getAccessToken();^n    const response = await axios.get(`${API}/users/${userId}/items/search`, {^n        headers: { Authorization: `Bearer ${token}` },^n        params: { limit: 50, ...params }^n    });^n    return response.data;^n};^n';fs.appendFileSync(p,c,'utf8');console.log('SEARCH USER ITEMS ADICIONADO');"

:check
echo.
node --check "%P%"
if errorlevel 1 (
  echo ERRO DE SINTAXE. Restaure o backup:
  echo copy /Y "%P%.antes-search-user-items-20260818" "%P%"
  exit /b 1
)
echo.
echo API OK.
pause
