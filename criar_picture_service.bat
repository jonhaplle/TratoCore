@echo off

(
echo const axios = require("axios");
echo.
echo async function uploadImage^(accessToken, imageUrl^) {
echo.
echo     const response = await axios.post^(
echo         "https://api.mercadolibre.com/pictures",
echo         {
echo             source: imageUrl
echo         },
echo         {
echo             headers: {
echo                 Authorization: "Bearer " + accessToken
echo             }
echo         }
echo     ^);
echo.
echo     return response.data;
echo.
echo }
echo.
echo module.exports = {
echo     uploadImage
echo };
)>api\services\ml\picture.service.js

echo.
echo ===============================
echo picture.service.js criado.
echo ===============================
pause