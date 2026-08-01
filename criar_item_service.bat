@echo off

(
echo const axios = require("axios");
echo.
echo async function createItem^(accessToken, item^) {
echo.
echo     const response = await axios.post^(
echo         "https://api.mercadolibre.com/items",
echo         item,
echo         {
echo             headers: {
echo                 Authorization: "Bearer " + accessToken,
echo                 "Content-Type": "application/json"
echo             }
echo         }
echo     ^);
echo.
echo     return response.data;
echo.
echo }
echo.
echo module.exports = {
echo     createItem
echo };
)>api\services\ml\item.service.js

echo.
echo ===========================
echo item.service.js criado.
echo ===========================
pause