@echo off
echo ===========================================
echo   建筑3D模型查看器 - 本地服务器
echo ===========================================
echo.
echo 正在启动本地服务器...
echo.
echo 在浏览器中打开: http://localhost:8080
echo 按 Ctrl+C 停止服务器
echo.

cd /d "%~dp0"

REM 尝试用 npx serve
where npx >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    npx serve . -p 8080 --no-clipboard
    goto :end
)

REM 尝试用 Python
where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    python -m http.server 8080
    goto :end
)

where python3 >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    python3 -m http.server 8080
    goto :end
)

echo 未找到 serve、python 或 python3。
echo 请安装其中之一，或者直接把整个 model-viewer 文件夹拖到 VS Code 中，
echo 用 Live Server 插件打开。
pause

:end
