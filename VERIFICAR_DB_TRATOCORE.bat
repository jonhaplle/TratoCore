@echo off
setlocal
cd /d C:\TratoCore

echo ================================================
echo TRATOCORE - VERIFICAR POSTGRES / GEMINI
echo ================================================
node -e "const db=require('./api/db'); db.query('SELECT current_database() db, current_user usuario, NOW() hora').then(r=>{console.log('POSTGRES OK'); console.log(r.rows[0]); return db.end();}).catch(e=>{console.error('POSTGRES ERRO'); console.error(e.message); process.exitCode=1;})"
echo.
curl -s http://localhost:3000/api/health
echo.
pause
