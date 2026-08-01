@echo off

(
echo const axios = require("axios");
echo.
echo const CLIENT_ID = process.env.ML_CLIENT_ID;
echo const CLIENT_SECRET = process.env.ML_CLIENT_SECRET;
echo const REDIRECT_URI = process.env.ML_REDIRECT_URI;
echo.
echo const BASE_URL = "https://api.mercadolibre.com";
echo.
echo function getAuthorizationUrl^(^) {
echo     const params = new URLSearchParams^({
echo         response_type: "code",
echo         client_id: CLIENT_ID,
echo         redirect_uri: REDIRECT_URI
echo     }^);
echo.
echo     return `https://auth.mercadolivre.com.br/authorization?${params.toString^(^)}`
echo }
echo.
echo async function getAccessToken^(code^) {
echo     const response = await axios.post^(
echo         `${BASE_URL}/oauth/token`,
echo         {
echo             grant_type: "authorization_code",
echo             client_id: CLIENT_ID,
echo             client_secret: CLIENT_SECRET,
echo             code,
echo             redirect_uri: REDIRECT_URI
echo         }
echo     ^);
echo.
echo     return response.data;
echo }
echo.
echo async function refreshToken^(refreshToken^) {
echo     const response = await axios.post^(
echo         `${BASE_URL}/oauth/token`,
echo         {
echo             grant_type: "refresh_token",
echo             client_id: CLIENT_ID,
echo             client_secret: CLIENT_SECRET,
echo             refresh_token: refreshToken
echo         }
echo     ^);
echo.
echo     return response.data;
echo }
echo.
echo module.exports = {
echo     getAuthorizationUrl,
echo     getAccessToken,
echo     refreshToken
echo };
)>api\services\ml\oauth.service.js

echo.
echo ==========================
echo oauth.service.js criado.
echo ==========================
pause